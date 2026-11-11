import { msg } from "@/i18n";
import type { Company, Fundamentals, Metric, Point } from "./yahoo";

/**
 * Every figure the Stocks app can show, compare or export, in one catalogue: reported figures,
 * ratios of two, growth, and market figures. Pure (no network): the research page's charts, the
 * comparison, the scatter, the custom ratio and the export all read figures through here.
 */

export type Period = "annual" | "quarterly";
export type Format = "amount" | "share" | "percent" | "ratio" | "count";

/** What is known of one symbol, as far as figures go. */
export interface SymbolFacts {
  symbol: string;
  price: number | null;
  fundamentals: Fundamentals | null;
  company: Company | null;
}

export interface Measure {
  id: string;
  label: string;
  format: Format;
  /** Per period, oldest first; absent for figures that only exist today (price, P/E…). */
  series?: (f: Fundamentals, period: Period) => Point[];
  /** Today's value; by default the last point of `series`. */
  latest?: (s: SymbolFacts) => number | null;
}

const reported = (f: Fundamentals, m: Metric, period: Period) => f[period][m] ?? [];

/** Points of `of` divided by `over` on the same day, times `scale`; days missing either are left out. */
function ratio(f: Fundamentals, period: Period, of: Metric | ((day: string) => number | undefined), over: Metric, scale = 1): Point[] {
  const top = typeof of === "function" ? of : (day: string) => reported(f, of, period).find((p) => p.day === day)?.value;
  return reported(f, over, period).flatMap((p) => {
    const v = top(p.day);
    return v === undefined || !p.value ? [] : [{ day: p.day, value: (v / p.value) * scale }];
  });
}

/** Change against the period before, in percent (a year, or the same quarter a year earlier). */
function growth(f: Fundamentals, m: Metric, period: Period): Point[] {
  const points = reported(f, m, period);
  const lag = period === "annual" ? 1 : 4;
  return points.flatMap((p, i) => {
    const before = points[i - lag];
    return before && before.value > 0 ? [{ day: p.day, value: (p.value / before.value - 1) * 100 }] : [];
  });
}

/** Yearly growth over the last `years` fiscal years, compounded, in percent. */
export function cagr(points: Point[], years: number): number | null {
  if (points.length <= years) return null;
  const last = points[points.length - 1].value;
  const first = points[points.length - 1 - years].value;
  return first > 0 && last > 0 ? ((last / first) ** (1 / years) - 1) * 100 : null;
}

const plus = (f: Fundamentals, period: Period, a: Metric, b: Metric) => (day: string) => {
  const x = reported(f, a, period).find((p) => p.day === day)?.value;
  const y = reported(f, b, period).find((p) => p.day === day)?.value;
  return x === undefined || y === undefined ? undefined : x - y;
};

const REPORTED: { metric: Metric; label: string; format: Format }[] = [
  { metric: "TotalRevenue", label: msg("Revenue"), format: "amount" },
  { metric: "GrossProfit", label: msg("Gross profit"), format: "amount" },
  { metric: "OperatingIncome", label: msg("Operating income"), format: "amount" },
  { metric: "NetIncome", label: msg("Net income"), format: "amount" },
  { metric: "EBITDA", label: msg("EBITDA"), format: "amount" },
  { metric: "DilutedEPS", label: msg("Earnings per share"), format: "share" },
  { metric: "OperatingCashFlow", label: msg("Operating cash flow"), format: "amount" },
  { metric: "FreeCashFlow", label: msg("Free cash flow"), format: "amount" },
  { metric: "CapitalExpenditure", label: msg("Capital expenditure"), format: "amount" },
  { metric: "ResearchAndDevelopment", label: msg("Research and development"), format: "amount" },
  { metric: "InterestExpense", label: msg("Interest expense"), format: "amount" },
  { metric: "CashDividendsPaid", label: msg("Dividends paid"), format: "amount" },
  { metric: "RepurchaseOfCapitalStock", label: msg("Share buybacks"), format: "amount" },
  { metric: "DilutedAverageShares", label: msg("Shares outstanding"), format: "count" },
  { metric: "TotalAssets", label: msg("Total assets"), format: "amount" },
  { metric: "TotalLiabilitiesNetMinorityInterest", label: msg("Total liabilities"), format: "amount" },
  { metric: "StockholdersEquity", label: msg("Equity"), format: "amount" },
  { metric: "TotalDebt", label: msg("Debt"), format: "amount" },
  { metric: "CashAndCashEquivalents", label: msg("Cash"), format: "amount" },
  { metric: "CurrentAssets", label: msg("Current assets"), format: "amount" },
  { metric: "CurrentLiabilities", label: msg("Current liabilities"), format: "amount" },
  { metric: "InvestedCapital", label: msg("Invested capital"), format: "amount" },
];

const stat = (key: keyof Company["stats"], scale = 1) => (s: SymbolFacts) => {
  const v = s.company?.stats[key];
  return v === null || v === undefined ? null : v * scale;
};
const trailing = (s: SymbolFacts, key: keyof Fundamentals["trailing"]) => s.fundamentals?.trailing[key] ?? null;

export const MEASURES: Measure[] = [
  ...REPORTED.map((r) => ({ id: r.metric, label: r.label, format: r.format, series: (f: Fundamentals, p: Period) => reported(f, r.metric, p) })),
  // Margins and returns, in percent.
  { id: "grossMargin", label: msg("Gross margin"), format: "percent", series: (f, p) => ratio(f, p, "GrossProfit", "TotalRevenue", 100) },
  { id: "operatingMargin", label: msg("Operating margin"), format: "percent", series: (f, p) => ratio(f, p, "OperatingIncome", "TotalRevenue", 100) },
  { id: "netMargin", label: msg("Net margin"), format: "percent", series: (f, p) => ratio(f, p, "NetIncome", "TotalRevenue", 100) },
  { id: "fcfMargin", label: msg("Free cash flow margin"), format: "percent", series: (f, p) => ratio(f, p, "FreeCashFlow", "TotalRevenue", 100) },
  { id: "rdShare", label: msg("R&D share of revenue"), format: "percent", series: (f, p) => ratio(f, p, "ResearchAndDevelopment", "TotalRevenue", 100) },
  { id: "roe", label: msg("Return on equity"), format: "percent", series: (f, p) => ratio(f, p, "NetIncome", "StockholdersEquity", 100) },
  { id: "roic", label: msg("Return on invested capital"), format: "percent", series: (f, p) => ratio(f, p, "NetIncome", "InvestedCapital", 100) },
  { id: "payout", label: msg("Payout ratio"), format: "percent", series: (f, p) => ratio(f, p, (d) => -(reported(f, "CashDividendsPaid", p).find((x) => x.day === d)?.value ?? NaN), "NetIncome", 100).filter((x) => Number.isFinite(x.value)) },
  // Balance sheet.
  { id: "netDebtToEbitda", label: msg("Net debt / EBITDA"), format: "ratio", series: (f, p) => ratio(f, p, plus(f, p, "TotalDebt", "CashAndCashEquivalents"), "EBITDA") },
  { id: "debtToEquity", label: msg("Debt / equity"), format: "ratio", series: (f, p) => ratio(f, p, "TotalDebt", "StockholdersEquity") },
  { id: "currentRatio", label: msg("Current ratio"), format: "ratio", series: (f, p) => ratio(f, p, "CurrentAssets", "CurrentLiabilities") },
  // Growth against the period before.
  { id: "revenueGrowth", label: msg("Revenue growth"), format: "percent", series: (f, p) => growth(f, "TotalRevenue", p) },
  { id: "epsGrowth", label: msg("EPS growth"), format: "percent", series: (f, p) => growth(f, "DilutedEPS", p) },
  { id: "revenueCagr3", label: msg("Revenue growth, 3 years a year"), format: "percent", latest: (s) => cagr(s.fundamentals?.annual.TotalRevenue ?? [], 3) },
  { id: "epsCagr3", label: msg("EPS growth, 3 years a year"), format: "percent", latest: (s) => cagr(s.fundamentals?.annual.DilutedEPS ?? [], 3) },
  // The market's view, today.
  { id: "price", label: msg("Price"), format: "share", latest: (s) => s.price },
  { id: "marketCap", label: msg("Market cap"), format: "amount", latest: (s) => trailing(s, "MarketCap") ?? stat("marketCap")(s) },
  { id: "pe", label: msg("P/E"), format: "ratio", latest: (s) => trailing(s, "PeRatio") ?? stat("trailingPE")(s) },
  { id: "forwardPe", label: msg("Forward P/E"), format: "ratio", latest: stat("forwardPE") },
  { id: "peg", label: msg("PEG"), format: "ratio", latest: stat("peg") },
  { id: "ps", label: msg("P/S"), format: "ratio", latest: (s) => trailing(s, "PsRatio") },
  { id: "pb", label: msg("P/B"), format: "ratio", latest: (s) => trailing(s, "PbRatio") },
  { id: "evToEbitda", label: msg("EV / EBITDA"), format: "ratio", latest: (s) => evToEbitda(s) },
  {
    id: "fcfYield",
    label: msg("Free cash flow yield"),
    format: "percent",
    latest: (s) => {
      const fcf = trailing(s, "FreeCashFlow");
      const cap = trailing(s, "MarketCap");
      return fcf !== null && cap ? (fcf / cap) * 100 : null;
    },
  },
  { id: "dividendYield", label: msg("Dividend yield"), format: "percent", latest: stat("dividendYield", 100) },
  { id: "beta", label: msg("Beta"), format: "ratio", latest: stat("beta") },
  { id: "analystUpside", label: msg("Analysts' target, upside"), format: "percent", latest: (s) => (s.price && s.company?.analysts?.targetMean ? (s.company.analysts.targetMean / s.price - 1) * 100 : null) },
];

function evToEbitda(s: SymbolFacts): number | null {
  const ev = trailing(s, "EnterpriseValue");
  const ebitda = s.fundamentals?.annual.EBITDA?.at(-1)?.value;
  return ev !== null && ebitda ? ev / ebitda : null;
}

const BY_ID = new Map(MEASURES.map((m) => [m.id, m]));
export const measure = (id: string) => BY_ID.get(id);

/** The measure per period (empty for today-only ones or when nothing is known). */
export const seriesOf = (id: string, s: SymbolFacts, period: Period): Point[] => {
  const m = BY_ID.get(id);
  return m?.series && s.fundamentals ? m.series(s.fundamentals, period) : [];
};

/** The measure today: its own reading, else its last period. */
export function latestOf(id: string, s: SymbolFacts): number | null {
  const m = BY_ID.get(id);
  if (!m) return null;
  if (m.latest) return m.latest(s);
  return seriesOf(id, s, "annual").at(-1)?.value ?? null;
}

/** "2025" for a fiscal year, "Q3 25" for a quarter. */
export const periodName = (day: string, period: Period) => (period === "annual" ? day.slice(0, 4) : `Q${Math.ceil(Number(day.slice(5, 7)) / 3)} ${day.slice(2, 4)}`);

/** A over B, period by period: the two series matched on the period's name (two companies' fiscal years rarely end the same day). */
export function divideSeries(a: Point[], b: Point[], period: Period): { period: string; value: number }[] {
  const below = new Map(b.map((p) => [periodName(p.day, period), p.value]));
  return a.flatMap((p) => {
    const name = periodName(p.day, period);
    const d = below.get(name);
    return d ? [{ period: name, value: p.value / d }] : [];
  });
}

/** Kinds of measures, for pickers: reported figures, ratios worked out from them, and the market's view today. */
export type MeasureGroup = "reported" | "ratios" | "market";
export const groupOf = (m: Measure): MeasureGroup => (!m.series ? "market" : /^[A-Z]/.test(m.id) ? "reported" : "ratios");
