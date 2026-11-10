import { httpJson, trimSlash } from "@/lib/http";

/**
 * Yahoo Finance, without a key: quotes and price history (chart), symbol search, and company
 * figures (fundamentals time series). These endpoints are unofficial, so every answer is parsed
 * defensively and callers keep the last good one (see ./cache).
 */

// Yahoo rejects requests without a browser-like user agent.
// (It also rate-limits some UA strings, e.g. Linux Chrome, so this one is deliberate.)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/** PAGE_YAHOO_URL points tests at a mock. */
const base = () => trimSlash(process.env.PAGE_YAHOO_URL ?? "https://query1.finance.yahoo.com");
const get = <T>(path: string) => httpJson<T>(`${base()}${path}`, { headers: { "User-Agent": UA }, timeoutMs: 12_000 });

const dayOf = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

// ---------- quotes and price history ----------

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

// ---------- search ----------

export interface SymbolHit {
  symbol: string;
  name: string;
  exchange: string | null;
  /** EQUITY, ETF, INDEX, CURRENCY, CRYPTOCURRENCY, MUTUALFUND… */
  type: string;
  sector: string | null;
  industry: string | null;
}

interface YahooSearch {
  quotes?: { symbol?: string; shortname?: string; longname?: string; exchDisp?: string; quoteType?: string; sector?: string; industry?: string }[];
}

export function parseSearch(r: YahooSearch): SymbolHit[] {
  return (r.quotes ?? [])
    .filter((q): q is typeof q & { symbol: string } => typeof q.symbol === "string" && q.symbol.length > 0)
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname ?? q.shortname ?? q.symbol,
      exchange: q.exchDisp ?? null,
      type: q.quoteType ?? "EQUITY",
      sector: q.sector ?? null,
      industry: q.industry ?? null,
    }));
}

export const searchSymbols = async (q: string) => parseSearch(await get<YahooSearch>(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`));

// ---------- company figures ----------

/** Reported per fiscal year and per quarter. */
export const METRICS = [
  "TotalRevenue",
  "GrossProfit",
  "OperatingIncome",
  "NetIncome",
  "EBITDA",
  "DilutedEPS",
  "OperatingCashFlow",
  "FreeCashFlow",
  "DilutedAverageShares",
  "TotalDebt",
  "CashAndCashEquivalents",
  "StockholdersEquity",
  "CashDividendsPaid",
] as const;
export type Metric = (typeof METRICS)[number];

/** Over the last twelve months, or as of the last close. */
const TRAILING = ["MarketCap", "EnterpriseValue", "PeRatio", "PsRatio", "PbRatio", "TotalRevenue", "NetIncome", "DilutedEPS", "FreeCashFlow"] as const;
export type Trailing = (typeof TRAILING)[number];

export interface Point {
  /** The period's last day (YYYY-MM-DD). */
  day: string;
  value: number;
}

export interface Fundamentals {
  /** What the company reports in (not always what its shares are quoted in). */
  currency: string | null;
  annual: Partial<Record<Metric, Point[]>>;
  quarterly: Partial<Record<Metric, Point[]>>;
  trailing: Partial<Record<Trailing, number>>;
}

interface YahooSeries {
  timeseries?: {
    result?: (Record<string, unknown> & { meta?: { type?: string[] } })[] | null;
    error?: { description?: string } | null;
  };
}
type RawPoint = { asOfDate?: string; currencyCode?: string; reportedValue?: { raw?: number } } | null;

export function parseFundamentals(r: YahooSeries): Fundamentals {
  if (!r.timeseries?.result) throw new Error(r.timeseries?.error?.description ?? "No data");
  const out: Fundamentals = { currency: null, annual: {}, quarterly: {}, trailing: {} };
  for (const series of r.timeseries.result) {
    const type = series.meta?.type?.[0];
    const match = type && /^(annual|quarterly|trailing)(\w+)$/.exec(type);
    if (!match) continue;
    const [, period, name] = match;
    const points = ((series[type] as RawPoint[] | undefined) ?? [])
      .filter((p): p is NonNullable<RawPoint> & { asOfDate: string } => typeof p?.asOfDate === "string" && typeof p.reportedValue?.raw === "number")
      .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
    if (!points.length) continue;
    if (period === "trailing") {
      if ((TRAILING as readonly string[]).includes(name)) out.trailing[name as Trailing] = points[points.length - 1].reportedValue!.raw!;
      continue;
    }
    if (!(METRICS as readonly string[]).includes(name)) continue;
    out.currency ??= points.find((p) => p.currencyCode)?.currencyCode ?? null;
    out[period as "annual" | "quarterly"][name as Metric] = points.map((p) => ({ day: p.asOfDate, value: p.reportedValue!.raw! }));
  }
  return out;
}

export async function fetchFundamentals(symbol: string): Promise<Fundamentals> {
  const types = [...METRICS.flatMap((m) => [`annual${m}`, `quarterly${m}`]), ...TRAILING.map((m) => `trailing${m}`)].join(",");
  const now = Math.floor(Date.now() / 1000);
  // Yahoo gives the last four years and five quarters whatever the window; asking wide costs nothing.
  return parseFundamentals(await get<YahooSeries>(`/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=${types}&period1=${now - 12 * 365 * 86_400}&period2=${now + 86_400}`));
}
