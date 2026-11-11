import { dayOf, getWithSession } from "./http";

/** The quote summary: who the company is, what is coming (results, dividends), what analysts say, and who holds it. */

const MODULES = ["assetProfile", "calendarEvents", "financialData", "recommendationTrend", "majorHoldersBreakdown", "institutionOwnership", "defaultKeyStatistics", "summaryDetail"];

export interface Recommendations {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface Company {
  profile: {
    country: string | null;
    city: string | null;
    website: string | null;
    employees: number | null;
    description: string | null;
    officers: { name: string; title: string }[];
  } | null;
  calendar: {
    /** Expected results days (one, or a window of two). */
    earnings: string[];
    exDividend: string | null;
    dividendPaid: string | null;
  };
  analysts: {
    targetLow: number | null;
    targetMean: number | null;
    targetHigh: number | null;
    /** buy, hold, sell… as Yahoo words it. */
    recommendation: string | null;
    /** 1 (strong buy) to 5 (strong sell). */
    score: number | null;
    count: number | null;
    /** This month's votes. */
    trend: Recommendations | null;
  } | null;
  holders: {
    /** 0 to 1. */
    insiders: number | null;
    institutions: number | null;
    institutionCount: number | null;
    top: { name: string; share: number | null; shares: number | null; value: number | null }[];
  };
  stats: {
    beta: number | null;
    trailingPE: number | null;
    forwardPE: number | null;
    peg: number | null;
    /** 0 to 1. */
    dividendYield: number | null;
    payoutRatio: number | null;
    marketCap: number | null;
    sharesOutstanding: number | null;
    shortOfFloat: number | null;
  };
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
/** Yahoo wraps numbers as { raw, fmt }; sometimes it sends them bare. */
const n = (v: unknown): number | null => {
  const raw = typeof v === "number" ? v : obj(v).raw;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
};
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const day = (v: unknown) => {
  const seconds = n(v);
  return seconds === null ? null : dayOf(seconds);
};

export function parseSummary(r: unknown): Company {
  const result = obj(obj(r).quoteSummary);
  const first = Array.isArray(result.result) ? obj(result.result[0]) : undefined;
  if (!first) throw new Error(s(obj(result.error).description) ?? "No data");
  const profile = obj(first.assetProfile);
  const cal = obj(first.calendarEvents);
  const fin = obj(first.financialData);
  const trend = (Array.isArray(obj(first.recommendationTrend).trend) ? (obj(first.recommendationTrend).trend as unknown[]) : []).map(obj).find((x) => x.period === "0m");
  const holders = obj(first.majorHoldersBreakdown);
  const owners = obj(first.institutionOwnership).ownershipList;
  const stats = obj(first.defaultKeyStatistics);
  const detail = obj(first.summaryDetail);
  const earnings = obj(cal.earnings).earningsDate;
  const hasAnalysts = n(fin.numberOfAnalystOpinions) !== null || n(fin.targetMeanPrice) !== null;

  return {
    profile: first.assetProfile
      ? {
          country: s(profile.country),
          city: s(profile.city),
          website: s(profile.website),
          employees: n(profile.fullTimeEmployees),
          description: s(profile.longBusinessSummary),
          officers: (Array.isArray(profile.companyOfficers) ? profile.companyOfficers : [])
            .map(obj)
            .flatMap((o) => (s(o.name) ? [{ name: s(o.name)!, title: s(o.title) ?? "" }] : []))
            .slice(0, 5),
        }
      : null,
    calendar: {
      earnings: (Array.isArray(earnings) ? earnings : []).map(day).filter((d): d is string => d !== null),
      exDividend: day(cal.exDividendDate),
      dividendPaid: day(cal.dividendDate),
    },
    analysts: hasAnalysts
      ? {
          targetLow: n(fin.targetLowPrice),
          targetMean: n(fin.targetMeanPrice),
          targetHigh: n(fin.targetHighPrice),
          recommendation: s(fin.recommendationKey),
          score: n(fin.recommendationMean),
          count: n(fin.numberOfAnalystOpinions),
          trend: trend ? { strongBuy: n(trend.strongBuy) ?? 0, buy: n(trend.buy) ?? 0, hold: n(trend.hold) ?? 0, sell: n(trend.sell) ?? 0, strongSell: n(trend.strongSell) ?? 0 } : null,
        }
      : null,
    holders: {
      insiders: n(holders.insidersPercentHeld),
      institutions: n(holders.institutionsPercentHeld),
      institutionCount: n(holders.institutionsCount),
      top: (Array.isArray(owners) ? owners : [])
        .map(obj)
        .flatMap((o) => (s(o.organization) ? [{ name: s(o.organization)!, share: n(o.pctHeld), shares: n(o.position), value: n(o.value) }] : []))
        .slice(0, 10),
    },
    stats: {
      beta: n(stats.beta) ?? n(detail.beta),
      trailingPE: n(detail.trailingPE),
      forwardPE: n(stats.forwardPE) ?? n(detail.forwardPE),
      peg: n(stats.pegRatio),
      dividendYield: n(detail.dividendYield),
      payoutRatio: n(detail.payoutRatio),
      marketCap: n(detail.marketCap),
      sharesOutstanding: n(stats.sharesOutstanding),
      shortOfFloat: n(stats.shortPercentOfFloat),
    },
  };
}

export const fetchSummary = async (symbol: string) => parseSummary(await getWithSession(`/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES.join(",")}`));
