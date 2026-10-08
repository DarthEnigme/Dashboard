import crypto from "node:crypto";

/** Minimal RFC 4180 CSV parser with delimiter detection (comma, semicolon, tab). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? undefined : clean.indexOf("\n"));
  const delimiter = [";", "\t", ","].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row.map((x) => x.trim()));
  return rows;
}

export interface CsvMapping {
  /** Column indexes. Either `amount` (signed) or `debit`/`credit` (unsigned) is required. */
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
  category?: number;
  dateFormat: "auto" | "YMD" | "DMY" | "MDY";
  decimal: "." | ",";
  /** The first row holds column names. */
  header: boolean;
  /** Flip the sign of `amount` (for exports that list spending as positive). */
  invert?: boolean;
}

export interface ParsedTransaction {
  date: string; // YYYY-MM-DD
  amountCents: number;
  description: string;
  category?: string;
  externalId: string;
}

export function parseAmount(raw: string, decimal: "." | ","): number | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d.,\-+()]/g, "");
  const negative = /^\(.*\)$/.test(s) || s.includes("-");
  s = s.replace(/[()\-+]/g, "");
  s = decimal === "," ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || s === "") return null;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

export function parseDate(raw: string, format: CsvMapping["dateFormat"]): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  const other = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (iso && (format === "auto" || format === "YMD")) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (other && format !== "YMD") {
    const yy = +other[3] < 100 ? 2000 + +other[3] : +other[3];
    // "auto" prefers day-first (most banks outside the US) unless the first part can't be a day… or month.
    const mdy = format === "MDY" || (format === "auto" && +other[2] > 12);
    [y, m, d] = mdy ? [yy, +other[1], +other[2]] : [yy, +other[2], +other[1]];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Turn CSV rows into transactions. Each gets a stable id from its date, amount and description
 * (plus a counter for identical rows), so re-importing the same file adds nothing.
 */
export function mapRows(rows: string[][], map: CsvMapping): { transactions: ParsedTransaction[]; errors: string[] } {
  const transactions: ParsedTransaction[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  rows.slice(map.header ? 1 : 0).forEach((r, i) => {
    const line = i + (map.header ? 2 : 1);
    const date = parseDate(r[map.date] ?? "", map.dateFormat);
    let cents: number | null = null;
    if (map.amount !== undefined) {
      cents = parseAmount(r[map.amount] ?? "", map.decimal);
      if (cents !== null && map.invert) cents = -cents;
    } else {
      const debit = map.debit !== undefined ? parseAmount(r[map.debit] ?? "", map.decimal) : null;
      const credit = map.credit !== undefined ? parseAmount(r[map.credit] ?? "", map.decimal) : null;
      if (debit !== null || credit !== null) cents = (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0);
    }
    if (!date) return void errors.push(`Line ${line}: unreadable date "${r[map.date] ?? ""}"`);
    if (cents === null) return void errors.push(`Line ${line}: unreadable amount`);
    const description = (r[map.description] ?? "").replace(/\s+/g, " ").trim();
    const key = `${date}|${cents}|${description.toLowerCase()}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    transactions.push({
      date,
      amountCents: cents,
      description,
      category: map.category !== undefined ? r[map.category] || undefined : undefined,
      externalId: `csv:${crypto.createHash("sha1").update(`${key}|${n}`).digest("hex").slice(0, 20)}`,
    });
  });
  return { transactions, errors };
}

/** Guess a mapping from header names (English and French bank exports). */
export function guessMapping(header: string[]): Partial<CsvMapping> {
  const find = (re: RegExp) => {
    const i = header.findIndex((h) => re.test(h.toLowerCase()));
    return i === -1 ? undefined : i;
  };
  const amount = find(/^(amount|montant|betrag|value|valeur)/);
  return {
    date: find(/date|datum/),
    description: find(/desc|libell|label|memo|payee|bénéficiaire|beneficiaire|verwendung|name/),
    amount,
    debit: amount === undefined ? find(/debit|débit|withdraw|out/) : undefined,
    credit: amount === undefined ? find(/credit|crédit|deposit|in$/) : undefined,
    category: find(/categ|catég/),
  };
}

/** RFC 4180 CSV (comma, CRLF), quoting cells that need it. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Spreadsheets run text starting with = + - @ as a formula: prefix it with ' so it stays text. */
export const safeText = (s: string | null | undefined) => (s && /^[=+\-@\t\r]/.test(s) ? `'${s}` : (s ?? ""));

/** "-1234" cents → "-12.34", the way the importer reads it back with decimal ".". */
export const centsToDecimal = (cents: number) => `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
