// CSV writing helpers without server imports, so charts in the browser can export too.

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
