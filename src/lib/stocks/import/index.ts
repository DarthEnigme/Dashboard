import { parseCsv } from "../../finance/csv";
import { readXlsx } from "../../finance/xlsx";
import { errorReason } from "../../cache";
import { localDay } from "../../day";
import { quoteCurrency, search } from "../service";
import { addImported, knownIds } from "../store";
import { SYMBOL } from "../types";
import { PRESETS, readTrades, type ImportedTrade } from "./presets";

/**
 * Importing trades: read a broker's file, find each line's Yahoo symbol (from its ISIN when it
 * has one), show what would be added, then add it. A broker's sync goes through `resolveTrades`
 * and `saveTrades` the same way.
 */

export interface PreparedTrade extends ImportedTrade {
  /** The Yahoo symbol it will be recorded under; null when none was found. */
  yahoo: string | null;
  /** What that symbol is quoted in. */
  quoted: string | null;
  duplicate: boolean;
  /** Why it can't be added, or what to check. */
  problem: string | null;
  /** It will be added (it has a symbol and isn't dated after today). */
  addable: boolean;
}
/** A trade with its symbol found, before it is checked against the portfolio. */
export type ResolvedTrade = Omit<PreparedTrade, "duplicate" | "addable">;

export interface Prepared {
  preset: string;
  presets: { id: string; label: string }[];
  trades: PreparedTrade[];
  errors: string[];
}

/** Rows of a .csv or .xlsx file. */
export function rowsOf(name: string, bytes: Uint8Array): string[][] {
  if (/\.xlsx$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return readXlsx(Buffer.from(bytes));
  return parseCsv(new TextDecoder().decode(bytes));
}

/** The Yahoo symbol of an ISIN (Yahoo's search knows them), or of a ticker Yahoo uses as is. */
async function yahooSymbol(t: Pick<ImportedTrade, "isin" | "symbol">): Promise<string> {
  if (t.isin) {
    const hits = await search(t.isin);
    const hit = hits.find((h) => ["EQUITY", "ETF", "MUTUALFUND"].includes(h.type)) ?? hits[0];
    if (hit) return hit.symbol;
    if (!t.symbol) throw new Error(`Yahoo Finance doesn't know ${t.isin}`);
  }
  if (t.symbol && SYMBOL.test(t.symbol)) return t.symbol;
  throw new Error(`no Yahoo symbol for ${t.symbol ?? t.isin}`);
}

/** Each trade with its Yahoo symbol and quote currency, looked up once per instrument. Prices in pence get written in pounds' hundredths as Yahoo quotes them. */
export async function resolveTrades(trades: ImportedTrade[]): Promise<ResolvedTrade[]> {
  const keys = [...new Set(trades.map((t) => t.isin ?? t.symbol ?? ""))];
  type Found = { symbol: string; quoted: string } | string;
  const found = new Map<string, Found>(
    await Promise.all(
      keys.map(async (key): Promise<[string, Found]> => {
        const t = trades.find((x) => (x.isin ?? x.symbol) === key)!;
        try {
          const symbol = await yahooSymbol(t);
          return [key, { symbol, quoted: await quoteCurrency(symbol) }];
        } catch (e) {
          return [key, errorReason(e)];
        }
      }),
    ),
  );
  return trades.map((t) => {
    const r = found.get(t.isin ?? t.symbol ?? "")!;
    if (typeof r === "string") return { ...t, yahoo: null, quoted: null, problem: r };
    // Yahoo quotes London in pence (GBp) when brokers write pounds.
    const pence = r.quoted !== r.quoted.toUpperCase() && t.currency === r.quoted.toUpperCase();
    const mismatch = t.currency && !pence && t.currency !== r.quoted.toUpperCase();
    // The fees are kept in the quote currency too, so they move to pence with the price.
    const scaled = pence ? { price: t.price * 100, fees: t.fees * 100 } : {};
    return { ...t, ...scaled, yahoo: r.symbol, quoted: r.quoted, problem: mismatch ? `traded in ${t.currency}, quoted in ${r.quoted}: check the price` : null };
  });
}

/** What importing `rows` into `portfolio` would add. */
export async function prepareImport(userId: number, portfolio: number, rows: string[][], presetId?: string): Promise<Prepared> {
  const { preset, trades, errors } = readTrades(rows, presetId);
  const resolved = await resolveTrades(trades);
  const known = knownIds(userId, portfolio, resolved.map((t) => t.externalId));
  const today = localDay();
  return {
    preset: preset.id,
    presets: PRESETS.map((p) => ({ id: p.id, label: p.label })),
    trades: resolved.map((t) => ({
      ...t,
      problem: t.problem ?? (t.date > today ? "dated after today: it will be left out" : null),
      duplicate: known.has(t.externalId),
      addable: recordable(t, today),
    })),
    errors,
  };
}

/** A trade that can be recorded: its symbol is known, and it isn't dated after today. */
const recordable = (t: ResolvedTrade, today: string) => !!(t.yahoo && t.quoted) && t.date <= today;

/** Add the trades that can be recorded (and aren't there yet); the others are counted, not refused all together. */
export function saveTrades(userId: number, portfolio: number, trades: ResolvedTrade[], source: string) {
  const today = localDay();
  const ready = trades.filter((t) => recordable(t, today));
  const { added, skipped } = addImported(
    userId,
    portfolio,
    ready.map((t) => ({ symbol: t.yahoo, kind: t.kind, date: t.date, quantity: t.quantity, price: t.price, fees: t.fees, note: `${source}${t.name ? ` · ${t.name}` : ""}`, currency: t.quoted!, external_id: t.externalId })),
  );
  return { added, skipped, unresolved: trades.length - ready.length };
}
