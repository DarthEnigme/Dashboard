/** Cleaners for what people send to the apps' stores: each returns null for anything unusable. */

/** Trimmed text of at most `max` characters; null when empty or not text. */
export const text = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);

/** A whole number within [min, max], also when sent as text. */
export const int = (n: unknown, min: number, max: number) => {
  const v = typeof n === "string" && n.trim() !== "" ? Number(n) : n;
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
};

/** A number within [min, max], also when sent as text (with a comma or a point). */
export const num = (n: unknown, min: number, max: number) => {
  const v = typeof n === "string" && n.trim() !== "" ? Number(n.trim().replace(",", ".")) : n;
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
};

/** A real calendar day written YYYY-MM-DD. */
export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Something shaped YYYY-MM-DD, else null. */
export const day = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

/** One of `allowed`, else `fallback`. */
export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Up to 20 tags of 40 characters, trimmed, without duplicates (ignoring case). */
export function cleanTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const tag = typeof t === "string" ? t.trim().slice(0, 40) : "";
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, 20);
}

/** Tags stored as a JSON list. */
export const parseTags = (json: string | null): string[] => {
  try {
    return cleanTags(JSON.parse(json ?? "[]"));
  } catch {
    return [];
  }
};
