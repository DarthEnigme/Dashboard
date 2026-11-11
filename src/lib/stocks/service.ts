import { errorReason } from "../cache";
import { daysBefore, localDay } from "../day";
import { remembered } from "./cache";
import { dividendsByYear, makeFx, summarize, thin, thinIndexes, toTrades, type Market, type Series } from "./portfolio";
import { listTransactions, listWatched } from "./store";
import type { SymbolFacts } from "./metrics";
import { BENCHMARKS, rangeStart, type Portfolio, type Range, type Research, type StocksData, type SymbolHit, type Transaction, type WatchQuote } from "./types";
import { fetchFundamentals, fetchHistory, fetchSummary, searchSymbols, type Company, type Fundamentals, type History } from "./yahoo";

/** What the Stocks pages show: the person's trades put together with what Yahoo knows. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 86_400_000;
/** How far back the shorter of the two histories kept per symbol goes: what quotes, alerts and a year's charts need. */
const RECENT_DAYS = 400;

/** The part of a history from `from` on. */
export function since(h: History, from: string): History {
  const start = h.days.findIndex((d) => d >= from);
  const cut = start === -1 ? h.days.length : start;
  return { ...h, days: h.days.slice(cut), closes: h.closes.slice(cut), dividends: h.dividends.filter((d) => d.day >= from), splits: h.splits.filter((s) => s.day >= from) };
}

/**
 * Daily closes since `from` (all of them without it). Each symbol keeps two histories, its recent
 * one and its whole one, and every caller's window is cut from one of them: one request serves them
 * all. Prices move during the day, so they are kept for a quarter of an hour.
 */
export async function history(symbol: string, from?: string): Promise<History> {
  const recentFrom = daysBefore(localDay(), RECENT_DAYS);
  const recent = !!from && from >= recentFrom;
  const h = await remembered<History>(`history:${symbol}:${recent ? "recent" : "all"}`, 15 * MINUTE, () => fetchHistory(symbol, recent ? recentFrom : undefined));
  return from ? since(h, from) : h;
}

/** Company figures. Funds, indexes and currencies have none; that isn't an error. */
export const fundamentalsOf = (symbol: string) => remembered<Fundamentals>(`fundamentals:${symbol}`, 12 * HOUR, () => fetchFundamentals(symbol)).catch(() => null);

/** Profile, calendar, analysts and holders: Yahoo's quote summary, which may be refused (then nothing is shown). */
export const companyOf = (symbol: string) => remembered<Company>(`summary:${symbol}`, 12 * HOUR, () => fetchSummary(symbol)).catch(() => null);

export const search = (q: string) => remembered<SymbolHit[]>(`search:${q.toLowerCase()}`, DAY, () => searchSymbols(q));

/** Name, sector and kind of a symbol (from the search index), or undefined when it isn't listed there. */
const profile = async (symbol: string) => (await search(symbol).catch(() => [])).find((h) => h.symbol === symbol);

/** What the symbol is quoted in: asked when a trade is saved, which also proves the symbol exists. */
export const quoteCurrency = async (symbol: string) => (await history(symbol, daysBefore(localDay(), 10))).currency;

const settle = async <K, V>(keys: K[], load: (key: K) => Promise<V>, errors: string[]) => {
  const out = new Map<K, V>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        out.set(key, await load(key));
      } catch (e) {
        errors.push(`${String(key)}: ${errorReason(e)}`);
      }
    }),
  );
  return out;
};

/** The portfolio page: one portfolio, or all of this person's together (shown in the first one's currency). */
export async function loadStocks(userId: number, portfolios: Portfolio[], portfolioId: number | undefined, benchmarkSymbol: string | undefined): Promise<StocksData> {
  const shown = portfolios.find((p) => p.id === portfolioId);
  const currency = (shown ?? portfolios[0]).currency;
  const transactions = listTransactions(userId, shown?.id);
  const benchmark = BENCHMARKS.find((b) => b.symbol === benchmarkSymbol)?.symbol ?? BENCHMARKS[0].symbol;
  const today = localDay();
  const errors: string[] = [];

  const symbols = [...new Set(transactions.map((t) => t.symbol))];
  // A few days of margin, so the first trade has a close before it and a rate to convert at.
  const from = transactions.length ? daysBefore(transactions[transactions.length - 1].date, 10) : today;
  const [histories, profiles, bench] = await Promise.all([
    settle(symbols, (s) => history(s, from), errors),
    settle(symbols, profile, []),
    transactions.length ? history(benchmark, from).catch(() => undefined) : undefined,
  ]);

  const foreign = [...new Set([...histories.values()].map((h) => h.currency.toUpperCase()))].filter((c) => c !== currency);
  const rates = await settle(foreign, (c) => history(`${c}${currency}=X`, from) as Promise<Series>, errors);
  const fx = makeFx(currency, rates);

  const markets = new Map<string, Market>([...histories].map(([symbol, h]) => [symbol, { ...h, sector: profiles.get(symbol)?.sector ?? null }]));
  const summary = summarize(toTrades(transactions), markets, fx, currency, today, bench);
  // Shown together, the portfolios are also told apart (for the composition chart).
  const byPortfolio =
    shown || portfolios.length < 2
      ? []
      : portfolios.flatMap((p) => summarize(toTrades(transactions.filter((t) => t.portfolio_id === p.id)), markets, fx, currency, today).positions.map((x) => ({ portfolio: p.id, symbol: x.symbol, value: x.value })));
  // The page draws a few hundred points, not every day of ten years.
  const keep = thinIndexes(summary.series.days.length, 600);
  const pick = <T>(xs: T[]) => keep.map((i) => xs[i]);
  const { series } = summary;
  return {
    ...summary,
    series: { days: pick(series.days), value: pick(series.value), invested: pick(series.invested), performance: pick(series.performance), benchmark: series.benchmark && pick(series.benchmark) },
    portfolios,
    portfolio: shown?.id ?? null,
    transactions,
    benchmark,
    errors,
    byPortfolio,
  };
}

/** The symbols someone watches, each with its price and its last weeks. */
export async function loadWatchlist(userId: number): Promise<WatchQuote[]> {
  const from = daysBefore(localDay(), 45);
  return Promise.all(
    listWatched(userId).map(async (symbol) => {
      try {
        const h = await history(symbol, from);
        return { symbol, name: h.name, currency: h.currency, price: h.price, change: h.change, closes: h.closes };
      } catch {
        return { symbol, name: symbol, currency: "", price: null, change: null, closes: [] };
      }
    }),
  );
}


/** The position in one symbol across someone's portfolios, in its quote currency. */
function holdingOf(transactions: Transaction[], market: Market, today: string): Research["holding"] {
  if (!transactions.length) return null;
  const trades = toTrades(transactions);
  const [p] = summarize(trades, new Map([[trades[0].symbol, market]]), () => 1, market.currency, today).positions;
  return p ? { quantity: p.quantity, avgCost: p.avgCost, gainPct: p.gainPct } : null;
}

/** The research page of one symbol: price history over `range`, company figures, dividends, and what this person holds of it. */
export async function loadResearch(userId: number, symbol: string, range: Range): Promise<Research> {
  const today = localDay();
  const [h, info, fundamentals, company] = await Promise.all([history(symbol), profile(symbol), fundamentalsOf(symbol), companyOf(symbol)]);
  const chart = thin(since(h, rangeStart(range, today)), 500);
  const lastYear = h.dividends.filter((d) => d.day > daysBefore(today, 365)).reduce((s, d) => s + d.amount, 0);
  const hasFigures = fundamentals && (Object.keys(fundamentals.annual).length > 0 || Object.keys(fundamentals.trailing).length > 0);
  return {
    symbol: h.symbol,
    name: h.name,
    exchange: h.exchange,
    currency: h.currency,
    type: info?.type ?? null,
    sector: info?.sector ?? null,
    industry: info?.industry ?? null,
    price: h.price,
    change: h.change,
    high52: h.high52,
    low52: h.low52,
    chart,
    fundamentals: hasFigures ? fundamentals : null,
    company,
    dividends: dividendsByYear(h.dividends),
    dividendYield: lastYear > 0 && h.price > 0 ? (lastYear / h.price) * 100 : null,
    holding: holdingOf(
      listTransactions(userId).filter((t) => t.symbol === h.symbol),
      h,
      today,
    ),
    watched: listWatched(userId).includes(h.symbol),
  };
}

/** What the measures catalogue reads of a symbol: its price, company figures and quote summary. */
export async function factsFor(symbol: string): Promise<SymbolFacts & { name: string; currency: string }> {
  const [h, fundamentals, company] = await Promise.all([history(symbol, daysBefore(localDay(), 10)).catch(() => undefined), fundamentalsOf(symbol), companyOf(symbol)]);
  return { symbol, name: h?.name ?? symbol, currency: h?.currency ?? "", price: h?.price ?? null, fundamentals, company };
}
