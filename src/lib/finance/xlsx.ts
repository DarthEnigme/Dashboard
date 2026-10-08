import zlib from "node:zlib";
import { XMLParser } from "fast-xml-parser";

/**
 * Just enough of .xlsx to import a bank statement: the first sheet with data, as rows of strings
 * (like parseCsv). Numbers come out with a "." decimal point; cells formatted as dates come out
 * as YYYY-MM-DD. No dependency: an .xlsx is a zip of XML files.
 */

const MAX_UNZIPPED = 64 * 1024 * 1024;

/** Entries of a zip archive, by name (stored or deflated; that is all Office writes). */
export function unzip(buf: Buffer): Map<string, () => Buffer> {
  // End of central directory: the last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not an .xlsx file (no zip directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Damaged .xlsx file");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    out.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED });
      throw new Error(`Unsupported compression in .xlsx (method ${method})`);
    });
  }
  return out;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  // Keep text exactly as written ("007", " leading space").
  trimValues: false,
  isArray: (name) => ["sheet", "Relationship", "row", "c", "si", "r", "numFmt", "xf"].includes(name),
});

type Node = Record<string, unknown>;
const arr = <T = Node>(v: unknown): T[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]) as T[];

/** All the text inside a node (shared strings may be split into formatted runs). */
function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "object") return String(v);
  const n = v as Node;
  if ("t" in n) return arr<unknown>(n.t).map(text).join("");
  if ("#text" in n) return String(n["#text"]);
  if ("r" in n) return arr(n.r).map(text).join("");
  return "";
}

/** Built-in number formats that are dates (ECMA-376 18.8.30). */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const isDateCode = (code: string) => /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ""));

/** Column index from a cell reference: "C7" → 2. */
export function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Spreadsheet day number → YYYY-MM-DD (1900 system, with its fake 29 Feb 1900; or 1904). */
export function serialToDate(serial: number, date1904 = false): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

export function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const xml = (name: string) => {
    const f = files.get(name);
    return f ? (parser.parse(f().toString("utf8")) as Node) : undefined;
  };
  const workbook = xml("xl/workbook.xml")?.workbook as Node | undefined;
  if (!workbook) throw new Error("Not an .xlsx file (no workbook)");
  const date1904 = ["1", "true"].includes(String((workbook.workbookPr as Node | undefined)?.["@_date1904"]));

  const shared = arr((xml("xl/sharedStrings.xml")?.sst as Node | undefined)?.si).map(text);

  const styles = xml("xl/styles.xml")?.styleSheet as Node | undefined;
  const custom = new Map(arr((styles?.numFmts as Node | undefined)?.numFmt).map((f) => [Number(f["@_numFmtId"]), String(f["@_formatCode"] ?? "")]));
  const dateStyle = arr((styles?.cellXfs as Node | undefined)?.xf).map((xf) => {
    const id = Number(xf["@_numFmtId"] ?? 0);
    return DATE_FORMATS.has(id) || (custom.has(id) && isDateCode(custom.get(id)!));
  });

  // Sheets in workbook order, through the relationships file.
  const rels = new Map(
    arr((xml("xl/_rels/workbook.xml.rels")?.Relationships as Node | undefined)?.Relationship).map((r) => [String(r["@_Id"]), String(r["@_Target"])]),
  );
  const paths = arr((workbook.sheets as Node | undefined)?.sheet)
    .map((s) => rels.get(String(s["@_r:id"])))
    .filter((t): t is string => !!t)
    .map((t) => (t.startsWith("/") ? t.slice(1) : `xl/${t}`));

  for (const path of paths) {
    const data = (xml(path)?.worksheet as Node | undefined)?.sheetData as Node | undefined;
    const rows: string[][] = [];
    for (const row of arr(data?.row)) {
      const cells: string[] = [];
      arr(row.c).forEach((c, i) => {
        const at = c["@_r"] ? colIndex(String(c["@_r"])) : i;
        const t = c["@_t"];
        const v = c.v === undefined ? undefined : text(c.v);
        let value = "";
        if (t === "s") value = shared[Number(v)] ?? "";
        else if (t === "inlineStr") value = text(c.is);
        else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (t === "e") value = "";
        else if (t === "str" || t === "d") value = v ?? "";
        else if (v !== undefined) {
          const n = Number(v);
          // Shortest form: Excel stores -4.2 as -4.2000000000000002.
          value = !Number.isFinite(n) ? v : dateStyle[Number(c["@_s"] ?? 0)] ? serialToDate(n, date1904) : String(n);
        }
        cells[at] = value.trim();
      });
      const full = Array.from(cells, (x) => x ?? "");
      if (full.some((x) => x !== "")) rows.push(full);
    }
    if (rows.length) {
      // Square the rows off so every row has the same columns.
      const width = Math.max(...rows.map((r) => r.length));
      return rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
    }
  }
  return [];
}

/** Zip files start with "PK\x03\x04". */
export const isZip = (b: Buffer) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;
