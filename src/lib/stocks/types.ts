/** The shapes of the Stocks app, shared by the server and the pages (nothing here touches the database or the network). */
import type { Company, Fundamentals } from "./yahoo";

export type { Company, Fundamentals, Metric, Point, Recommendations, SymbolHit } from "./yahoo";

export const TRADE_KINDS = ["buy", "sell"] as const;
export type TradeKind = (typeof TRADE_KINDS)[number];

export interface Portfolio {
  id: number;
  name: string;
  /** What its totals are shown in. */
  currency: string;
}

/** A buy or a sell, as entered: price and fees in the currency the symbol is quoted in. */
export interface Transaction {
  id: number;
  portfolio_id: number;
  symbol: string;
  kind: TradeKind;
  date: string;
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  note: string | null;
  /** Its id at the broker or in the file it was imported from. */
  external_id: string | null;
}

export interface Position {
  symbol: string;
  name: string;
  /** What the symbol is quoted in. */
  currency: string;
  sector: string | null;
  /** Shares held now, counted in today's shares (after splits). */
  quantity: number;
  /** Average cost of a share held, fees included, in the quote currency. */
  avgCost: number;
  price: number;
  /** Today, in percent; null when unknown. */
  change: number | null;
  /** In the portfolio's currency from here on. */
  value: number;
  cost: number;
  /** Value minus cost of what is held. */
  gain: number;
  gainPct: number | null;
  /** Made (or lost) on shares sold. */
  realized: number;
  /** Received since the first buy, before tax. */
  dividends: number;
  /** Share of the portfolio's value, 0 to 1. */
  weight: number;
  /** True when Yahoo had no price: valued at the last price paid. */
  unpriced: boolean;
}

export interface Summary {
  currency: string;
  value: number;
  cost: number;
  gain: number;
  gainPct: number | null;
  realized: number;
  dividends: number;
  dayChange: number;
  dayChangePct: number | null;
  /** Held now, largest first. */
  positions: Position[];
  /** Sold entirely: what they made. */
  closed: Position[];
  series: {
    days: string[];
    value: number[];
    /** Money put in, less money taken out. */
    invested: number[];
    /** Time-weighted return since the first day, in percent (prices only, dividends left out). */
    performance: number[];
    /** The benchmark's change over the same days, in percent. */
    benchmark: (number | null)[] | null;
  };
  dividendYears: { year: string; amount: number }[];
  /** Latest first. */
  dividendList: { day: string; symbol: string; amount: number }[];
}

export interface StocksData extends Summary {
  portfolios: Portfolio[];
  /** The portfolio shown, or null for all of them together. */
  portfolio: number | null;
  transactions: Transaction[];
  benchmark: string;
  /** Symbols Yahoo didn't answer for. */
  errors: string[];
  /** All portfolios shown together: what each holds of each symbol (value, in `currency`). Empty otherwise. */
  byPortfolio: { portfolio: number; symbol: string; value: number }[];
}

export interface WatchQuote {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  change: number | null;
  /** Closes of the last weeks. */
  closes: number[];
}

export const RANGES = ["1m", "6m", "ytd", "1y", "5y", "max"] as const;
export type Range = (typeof RANGES)[number];

export interface Research {
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string;
  /** EQUITY, ETF, INDEX… */
  type: string | null;
  sector: string | null;
  industry: string | null;
  price: number;
  change: number | null;
  high52: number | null;
  low52: number | null;
  chart: { days: string[]; closes: number[] };
  /** Null for what has no company figures (funds, indexes, currencies). */
  fundamentals: Fundamentals | null;
  /** Profile, calendar, analysts and holders; null when Yahoo didn't say. */
  company: Company | null;
  /** Paid per share, by calendar year. */
  dividends: { year: string; amount: number }[];
  /** Last twelve months of dividends over the price, in percent. */
  dividendYield: number | null;
  /** What this person holds of it, across their portfolios (in the quote currency). */
  holding: { quantity: number; avgCost: number; gainPct: number | null } | null;
  watched: boolean;
}

/** One symbol on the compare page: its figures (for the measures catalogue), its prices over the range, and how it moves with the benchmark. */
export interface CompareSymbol {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  change: number | null;
  fundamentals: Fundamentals | null;
  company: Company | null;
  chart: { days: string[]; closes: number[] };
  beta: number | null;
  correlation: number | null;
  /** Yearly, in percent. */
  volatility: number | null;
  country: string | null;
}

export interface CompareData {
  range: Range;
  benchmark: { symbol: string; name: string; chart: { days: string[]; closes: number[] } };
  symbols: CompareSymbol[];
  /** The person's portfolios together, crossed with the market; null when not asked for or empty. */
  portfolio: {
    currency: string;
    value: number;
    cost: number;
    gain: number;
    gainPct: number | null;
    dividends: number;
    realized: number;
    holdings: { symbol: string; name: string; value: number; weight: number; sector: string | null; currency: string; country: string | null; beta: number | null }[];
    exposure: Record<"country" | "currency" | "sector", { name: string; value: number }[]>;
    beta: number | null;
  } | null;
}

/** Yahoo symbols: letters, digits and . ^ = - (AAPL, MC.PA, ^GSPC, EURUSD=X, BRK-B). */
export const SYMBOL = /^[A-Z0-9.^=-]{1,20}$/;

/** Indexes to compare a portfolio with. */
export const BENCHMARKS = [
  { symbol: "^GSPC", name: "S&P 500" },
  { symbol: "^NDX", name: "Nasdaq 100" },
  { symbol: "^FCHI", name: "CAC 40" },
  { symbol: "^STOXX50E", name: "Euro Stoxx 50" },
  { symbol: "IWDA.AS", name: "MSCI World (IWDA)" },
] as const;

// ---------- what clients send: unchecked, the store cleans every field ----------

export interface PortfolioInput {
  id?: unknown;
  name?: unknown;
  currency?: unknown;
}
export interface TransactionInput {
  id?: unknown;
  portfolio?: unknown;
  symbol?: unknown;
  kind?: unknown;
  date?: unknown;
  quantity?: unknown;
  price?: unknown;
  fees?: unknown;
  note?: unknown;
}
export interface AlertInput {
  id?: unknown;
  kind?: unknown;
  op?: unknown;
  value?: unknown;
  symbol?: unknown;
  portfolio?: unknown;
  channels?: unknown;
  note?: unknown;
  active?: unknown;
}
export interface BrokerInput {
  id?: unknown;
  kind?: unknown;
  portfolio?: unknown;
  secret?: unknown;
  account?: unknown;
}

/** All of someone's portfolios at a glance, for the dashboard widget. */
export interface StocksSummary {
  currency: string;
  value: number;
  dayChange: number;
  dayChangePct: number | null;
  holdings: number;
  best: { symbol: string; change: number } | null;
  worst: { symbol: string; change: number } | null;
}
