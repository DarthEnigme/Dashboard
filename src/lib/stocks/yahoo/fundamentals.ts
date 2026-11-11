import { get } from "./http";

/** Company figures: the fundamentals time series, per year, per quarter and trailing. */

/** Reported per fiscal year and per quarter: income statement, cash flow, balance sheet. */
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
  "ResearchAndDevelopment",
  "InterestExpense",
  "CapitalExpenditure",
  "RepurchaseOfCapitalStock",
  "TotalAssets",
  "TotalLiabilitiesNetMinorityInterest",
  "CurrentAssets",
  "CurrentLiabilities",
  "InvestedCapital",
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
