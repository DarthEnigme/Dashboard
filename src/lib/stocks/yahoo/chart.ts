import { dayOf, get } from "./http";

/** Quotes and daily price history (the chart endpoint). */
export interface YahooChart {
  chart: {
    result:
      | {
          meta: {
            symbol: string;
            shortName?: string;
            longName?: string;
            currency: string;
            regularMarketPrice: number;
            chartPreviousClose?: number;
            previousClose?: number;
            fiftyTwoWeekHigh?: number;
            fiftyTwoWeekLow?: number;
            fullExchangeName?: string;
            instrumentType?: string;
          };
          timestamp?: number[];
          events?: {
            dividends?: Record<string, { amount: number; date: number }>;
            splits?: Record<string, { date: number; numerator: number; denominator: number }>;
          };
          indicators?: { quote?: { close?: (number | null)[] }[] };
        }[]
      | null;
    error: { description: string } | null;
  };
}

export interface Quote {
  symbol: string;
  name?: string;
  price: number;
  /** Since the previous close, in percent. */
  change: number | null;
  currency: string;
}

export interface History {
  symbol: string;
  name: string;
  /** What prices are quoted in ("GBp" is pence). */
  currency: string;
  exchange: string | null;
  price: number;
  /** Since the previous trading day, in percent. */
  change: number | null;
  high52: number | null;
  low52: number | null;
  /** Trading days (YYYY-MM-DD), oldest first, and each one's close: adjusted for splits, not for dividends. */
  days: string[];
  closes: number[];
  /** Per share, on the ex-dividend day. */
  dividends: { day: string; amount: number }[];
  /** `ratio` new shares for each old one, from `day` on. */
  splits: { day: string; ratio: number }[];
}

const meta = (r: YahooChart) => {
  const result = r.chart?.result?.[0];
  if (!result?.meta) throw new Error(r.chart?.error?.description ?? "No data");
  return result;
};

/** The latest price from a chart answer of any range. */
export function parseYahoo(r: YahooChart): Quote {
  const m = meta(r).meta;
  const prev = m.chartPreviousClose ?? m.previousClose;
  return {
    symbol: m.symbol,
    name: m.shortName,
    price: m.regularMarketPrice,
    change: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null,
    currency: m.currency,
  };
}

/** Daily closes with dividends and splits. Days Yahoo has no close for (holidays in the feed) are dropped. */
export function parseHistory(r: YahooChart): History {
  const result = meta(r);
  const m = result.meta;
  const raw = result.indicators?.quote?.[0]?.close ?? [];
  const days: string[] = [];
  const closes: number[] = [];
  (result.timestamp ?? []).forEach((ts, i) => {
    const close = raw[i];
    if (typeof close !== "number" || !Number.isFinite(close)) return;
    const day = dayOf(ts);
    // The running day can come twice (the session's bar, then the live price): keep the later.
    if (days[days.length - 1] === day) closes[closes.length - 1] = close;
    else {
      days.push(day);
      closes.push(close);
    }
  });
  const before = closes[closes.length - 2];
  const byDay = <T extends { day: string }>(xs: T[]) => xs.sort((a, b) => a.day.localeCompare(b.day));
  return {
    symbol: m.symbol,
    name: m.longName ?? m.shortName ?? m.symbol,
    currency: m.currency,
    exchange: m.fullExchangeName ?? null,
    price: m.regularMarketPrice,
    change: before ? ((m.regularMarketPrice - before) / before) * 100 : null,
    high52: m.fiftyTwoWeekHigh ?? null,
    low52: m.fiftyTwoWeekLow ?? null,
    days,
    closes,
    dividends: byDay(Object.values(result.events?.dividends ?? {}).map((d) => ({ day: dayOf(d.date), amount: d.amount }))),
    splits: byDay(
      Object.values(result.events?.splits ?? {})
        .filter((s) => s.numerator > 0 && s.denominator > 0)
        .map((s) => ({ day: dayOf(s.date), ratio: s.numerator / s.denominator })),
    ),
  };
}

export const fetchQuote = async (symbol: string) => parseYahoo(await get<YahooChart>(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`));

/** Daily history since `from` (YYYY-MM-DD), or all of it. */
export async function fetchHistory(symbol: string, from?: string): Promise<History> {
  const period1 = from ? Math.floor(Date.parse(from) / 1000) : 0;
  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  return parseHistory(await get<YahooChart>(`/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits`));
}
