import { loadConfig } from "../../config/load";
import { remembered } from "../cache";
import { search } from "../service";
import { heldSymbols } from "../store";
import { INVESTORS } from "./list";
import { fetchFilings, fetchHoldings, type FilerFilings, type Holding13F } from "./sec";

/**
 * What a well-known investor holds: the last 13F report, compared with the one before, each
 * holding matched to a Yahoo symbol where one is found, and crossed with what you hold. Reports
 * are filed up to 45 days after their quarter: this is what they held then, not today.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Rows shown, largest first; and how many of them are matched to a symbol (one search each). */
const SHOWN = 60;
const MATCHED = 30;

export type HoldingChange = "new" | "added" | "reduced" | "same";

export interface InvestorHolding extends Holding13F {
  /** Percent of the report's total. */
  weight: number;
  change: HoldingChange;
  /** Shares now against the quarter before, in percent; null for a new one. */
  sharesChange: number | null;
  /** The Yahoo symbol, when one was found. */
  symbol: string | null;
  /** You hold this symbol too. */
  held: boolean;
}

export interface InvestorData {
  cik: number;
  name: string;
  manager: string | null;
  period: string;
  filed: string;
  previousPeriod: string | null;
  /** All holdings, in US dollars. */
  total: number;
  count: number;
  holdings: InvestorHolding[];
  /** Held the quarter before, gone now: what they were worth then. */
  sold: Pick<Holding13F, "issuer" | "title" | "value" | "putCall">[];
}

const keyOf = (h: Pick<Holding13F, "cusip" | "putCall">) => `${h.cusip}:${h.putCall ?? ""}`;

/** Each holding against the quarter before: new, added to, reduced, or the same; and what was sold entirely. */
export function compareQuarters(current: Holding13F[], previous: Holding13F[] | null) {
  const before = new Map((previous ?? []).map((h) => [keyOf(h), h]));
  const now = new Set(current.map(keyOf));
  const total = current.reduce((s, h) => s + h.value, 0);
  const holdings = current.map((h) => {
    const was = before.get(keyOf(h));
    const sharesChange = was && was.shares > 0 ? ((h.shares - was.shares) / was.shares) * 100 : null;
    const change: HoldingChange = !previous ? "same" : !was ? "new" : sharesChange === null || Math.abs(sharesChange) < 0.5 ? "same" : sharesChange > 0 ? "added" : "reduced";
    return { ...h, weight: total > 0 ? (h.value / total) * 100 : 0, change, sharesChange: was ? sharesChange : null };
  });
  const sold = (previous ?? []).filter((h) => !now.has(keyOf(h))).map(({ issuer, title, value, putCall }) => ({ issuer, title, value, putCall }));
  return { total, holdings, sold: sold.sort((a, b) => b.value - a.value) };
}

/** A US-style Yahoo symbol (AAPL, BRK-B): the listing a 13F holding is about, not a foreign line of it. */
const US_SYMBOL = /^[A-Z]{1,5}(-[A-Z])?$/;

/** The Yahoo symbol of a holding: by its CUSIP (Yahoo's search knows them), else by its name. */
async function symbolOf(h: Holding13F): Promise<string | null> {
  for (const q of [h.cusip, h.issuer]) {
    const hits = await search(q).catch(() => []);
    const hit = hits.find((x) => (x.type === "EQUITY" || x.type === "ETF") && US_SYMBOL.test(x.symbol));
    if (hit) return hit.symbol;
  }
  return null;
}

const contact = () => process.env.PAGE_SEC_CONTACT || loadConfig().settings.stocks.secContact || undefined;

/** A filer's last two 13F reports, compared, matched to symbols and crossed with what `userId` holds. */
export async function loadInvestor(userId: number, cik: number): Promise<InvestorData> {
  const who = contact();
  const filer = await remembered<FilerFilings>(`13f:filings:${cik}`, 12 * HOUR, () => fetchFilings(cik, who));
  const [last, before] = filer.filings;
  if (!last) throw new Error("No 13F report from this filer");
  // A filed report never changes: kept a month (the cache's longest).
  const holdingsOf = (f: typeof last) => remembered<Holding13F[]>(`13f:holdings:${f.accession}`, 30 * DAY, () => fetchHoldings(cik, f, who));
  const [current, previous] = await Promise.all([holdingsOf(last), before ? holdingsOf(before).catch(() => null) : null]);
  const { total, holdings, sold } = compareQuarters(current, previous);
  const shown = holdings.slice(0, SHOWN);
  const symbols = await Promise.all(shown.map((h, i) => (i < MATCHED && !h.putCall ? symbolOf(h) : null)));
  const mine = new Set(heldSymbols(userId));
  return {
    cik,
    name: filer.name,
    manager: INVESTORS.find((i) => i.cik === cik)?.manager ?? null,
    period: last.period,
    filed: last.filed,
    previousPeriod: before?.period ?? null,
    total,
    count: holdings.length,
    holdings: shown.map((h, i) => ({ ...h, symbol: symbols[i], held: !!symbols[i] && mine.has(symbols[i]!) })),
    sold: sold.slice(0, 20),
  };
}
