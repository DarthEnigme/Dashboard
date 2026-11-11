import crypto from "node:crypto";

/**
 * Broker exports read as trades. Each preset knows one broker's columns; `readTrades` finds the
 * preset a file fits (or takes the one asked for), reads every line and gives each trade a stable
 * id (the broker's own, else a fingerprint of the line), so importing the same file twice adds
 * nothing. Pure: no database, no network (symbols are looked up afterwards from ISINs).
 */

export interface ImportedTrade {
  /** A Yahoo symbol when the file has one that Yahoo uses as is; else resolved from the ISIN. */
  symbol: string | null;
  isin: string | null;
  name: string | null;
  kind: "buy" | "sell";
  date: string;
  quantity: number;
  /** Per share, in the currency the trade was made in. */
  price: number;
  fees: number;
  currency: string | null;
  externalId: string;
  /** Line in the file, for messages. */
  line: number;
}

type Kind = ImportedTrade["kind"];
type Fields = Omit<ImportedTrade, "externalId" | "line"> & { id: string | null };

export interface Preset {
  id: string;
  label: string;
  /** Columns that tell this broker's file apart: all of them, each by one of its names (normalised). */
  signature: string[][];
  /** One line as a trade, null for lines that aren't trades (dividends, deposits, fees), or a message. */
  read: (cell: (...names: string[]) => string, cells: string[], header: string[]) => Fields | null | string;
}

/** Lower case, no accents, single spaces: "Quantité" and "quantite " match. */
export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** "1.234,56", "1,234.56", "-12,5", "€ 3" → a number; null when unreadable. */
export function numberOf(raw: string): number | null {
  let s = raw.replace(/[^\d,.\-+eE]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  // The last separator is the decimal one; the other groups thousands.
  if (comma > dot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 2024-01-15, 20240115, 15-01-2024, 15/01/2024, 15.01.2024 (with a time after, or not) → YYYY-MM-DD. */
export function dayOf(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (m) return valid(m[1], m[2], m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  return m ? valid(m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0")) : null;
}
const valid = (y: string, mo: string, d: string) => {
  const day = `${y}-${mo}-${d}`;
  return Number(mo) >= 1 && Number(mo) <= 12 && !Number.isNaN(Date.parse(day)) ? day : null;
};

/** buy / sell from a broker's word for it; null for anything else (dividend, deposit…). */
export function kindOf(word: string): Kind | null {
  const w = norm(word);
  if (/\b(buy|bought|achat|kauf|acquisto|compra)\b/.test(w) || w === "b") return "buy";
  if (/\b(sell|sold|vente|verkauf|vendita|venta)\b/.test(w) || w === "s") return "sell";
  return null;
}

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const isinOf = (s: string) => (ISIN.test(s.trim().toUpperCase()) ? s.trim().toUpperCase() : null);
const abs = (n: number | null) => (n === null ? null : Math.abs(n));

/** The fields every preset ends with: quantity and fees are positive, the sign of a quantity says the side when nothing else does. */
function trade(f: { date: string; kind: Kind | null; quantity: number | null; price: number | null; fees?: number | null; isin?: string; symbol?: string | null; name?: string; currency?: string; id?: string }): Fields | string {
  const date = dayOf(f.date);
  if (!date) return `unreadable date "${f.date}"`;
  if (f.quantity === null || f.quantity === 0) return "no quantity";
  if (f.price === null) return "no price";
  const kind = f.kind ?? (f.quantity < 0 ? "sell" : "buy");
  return {
    symbol: f.symbol?.trim().toUpperCase() || null,
    isin: isinOf(f.isin ?? ""),
    name: f.name?.trim() || null,
    kind,
    date,
    quantity: Math.abs(f.quantity),
    price: Math.abs(f.price),
    fees: abs(f.fees ?? 0) ?? 0,
    currency: f.currency?.trim().toUpperCase() || null,
    id: f.id?.trim() || null,
  };
}

export const PRESETS: Preset[] = [
  {
    // What NanoDash exports: it comes back as it left.
    id: "nanodash",
    label: "NanoDash",
    signature: [["date"], ["symbol"], ["kind"], ["quantity"], ["price"]],
    read: (c) => trade({ date: c("date"), kind: kindOf(c("kind")), quantity: numberOf(c("quantity")), price: numberOf(c("price")), fees: numberOf(c("fees")), symbol: c("symbol"), isin: c("isin"), name: c("name"), currency: c("currency"), id: c("id") }),
  },
  {
    // Degiro, Transactions.csv (English or French). The trade's currency is the unnamed column after the price; sells have a negative quantity.
    id: "degiro",
    label: "Degiro",
    signature: [["isin", "code isin"], ["order id", "id ordre"]],
    read: (c, cells, header) => {
      const priceAt = header.findIndex((h) => h === "price" || h === "cours");
      return trade({
        date: c("date"),
        kind: null,
        quantity: numberOf(c("quantity", "quantite")),
        price: numberOf(c("price", "cours")),
        fees: numberOf(c("transaction and/or third", "transaction costs", "frais de courtage", "frais de transaction")),
        isin: c("isin", "code isin"),
        name: c("product", "produit"),
        currency: priceAt >= 0 ? cells[priceAt + 1] : undefined,
        id: c("order id", "id ordre"),
      });
    },
  },
  {
    // Trading 212, history export. Dividends, deposits and the like are other "Action"s.
    id: "trading212",
    label: "Trading 212",
    signature: [["action"], ["time"], ["isin"], ["no. of shares"]],
    read: (c) => {
      const kind = kindOf(c("action"));
      if (!kind) return null;
      return trade({
        date: c("time"),
        kind,
        quantity: numberOf(c("no. of shares")),
        price: numberOf(c("price / share")),
        fees: (numberOf(c("currency conversion fee")) ?? 0) + (numberOf(c("stamp duty reserve tax")) ?? 0) + (numberOf(c("transaction fee")) ?? 0),
        isin: c("isin"),
        name: c("name"),
        currency: c("currency (price / share)"),
        id: c("id"),
      });
    },
  },
  {
    // Interactive Brokers, a Flex query of trades as CSV. Sells have a negative quantity; commissions are negative.
    id: "ibkr",
    label: "Interactive Brokers",
    signature: [["tradedate"], ["tradeprice"]],
    read: (c) => {
      const category = norm(c("assetcategory"));
      if (category && category !== "stk") return null;
      return trade({
        date: c("tradedate"),
        kind: kindOf(c("buy/sell", "buysell")),
        quantity: numberOf(c("quantity")),
        price: numberOf(c("tradeprice")),
        fees: numberOf(c("ibcommission")),
        symbol: c("symbol"),
        isin: c("isin"),
        name: c("description"),
        currency: c("currencyprimary", "currency"),
        id: c("tradeid", "transactionid"),
      });
    },
  },
  {
    // Trade Republic and any other export with recognisable columns (English, French, German).
    id: "generic",
    label: "Trade Republic / other",
    signature: [],
    read: (c) => {
      const word = c("type", "transaction type", "typ", "operation", "sens", "side", "action");
      const kind = word ? kindOf(word) : null;
      if (word && !kind) return null;
      return trade({
        date: c("date", "datum", "trade date", "execution date", "date d'execution"),
        kind,
        quantity: numberOf(c("shares", "quantity", "quantite", "anzahl", "stuck", "number of shares")),
        price: numberOf(c("price", "share price", "prix", "cours", "kurs", "price per share")),
        fees: numberOf(c("fee", "fees", "frais", "gebuhr", "gebuhren", "commission")),
        symbol: c("symbol", "ticker"),
        isin: c("isin"),
        name: c("name", "description", "instrument", "titre", "wertpapier"),
        currency: c("currency", "devise", "wahrung"),
        id: c("id", "transaction id", "order id", "reference"),
      });
    },
  },
];

/** The preset whose signature a header matches best; the generic one when none does. */
export function detectPreset(header: string[]): Preset {
  const names = new Set(header.map(norm));
  return PRESETS.find((p) => p.signature.length && p.signature.every((alternatives) => alternatives.some((s) => names.has(s)))) ?? PRESETS[PRESETS.length - 1];
}

/** Every trade in `rows` (the first one is the header), with a message per line that couldn't be read. */
export function readTrades(rows: string[][], presetId?: string): { preset: Preset; trades: ImportedTrade[]; errors: string[] } {
  const header = (rows[0] ?? []).map(norm);
  const preset = PRESETS.find((p) => p.id === presetId) ?? detectPreset(header);
  const trades: ImportedTrade[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const cell = (...names: string[]) => {
      for (const n of names) {
        const at = header.indexOf(n);
        if (at >= 0 && cells[at]?.trim()) return cells[at].trim();
      }
      return "";
    };
    const read = preset.read(cell, cells, header);
    if (read === null) return;
    if (typeof read === "string") return void errors.push(`Line ${line}: ${read}`);
    if (!read.symbol && !read.isin) return void errors.push(`Line ${line}: no symbol or ISIN`);
    const { id, ...t } = read;
    // Without the broker's id, the line's content is its id (counted, for two identical trades).
    const key = `${t.date}|${t.isin ?? t.symbol}|${t.kind}|${t.quantity}|${t.price}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    // NanoDash's own ids come back as they were written.
    const externalId = id ? (preset.id === "nanodash" ? id : `${preset.id}:${id}`) : `line:${crypto.createHash("sha1").update(`${key}|${n}`).digest("hex").slice(0, 20)}`;
    trades.push({ ...t, externalId, line });
  });
  return { preset, trades, errors };
}
