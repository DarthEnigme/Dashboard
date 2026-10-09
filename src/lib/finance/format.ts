import { formatLocale } from "@/i18n/format";

/** Currency amount from cents; whole units for large values, in the page's language. Client-safe. */
export function money(cents: number, currency: string, signed = false) {
  const s = new Intl.NumberFormat(formatLocale(), { style: "currency", currency, maximumFractionDigits: Math.abs(cents) >= 100_000 ? 0 : 2 }).format(cents / 100);
  return signed && cents > 0 ? `+${s}` : s;
}

/** Chart colour of a category: its own colour, its palette slot, or the neutral "Other" grey. Client-safe. */
export const categoryColor = (slot: number | null | undefined, color?: string | null) =>
  color ? color : slot ? `var(--series-${slot})` : "var(--fg-muted)";

/** "2026-10" → "October 2026" (in the page's language); "2026" stays as is. */
export function periodLabel(period: string) {
  if (period.length === 4) return period;
  const s = new Date(`${period}-01T00:00:00Z`).toLocaleDateString(formatLocale(), { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2026-10" → "Oct" (or "Oct 26" when the year matters). */
export function monthLabel(ym: string, withYear = false) {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(formatLocale() === "en-US" ? "en-GB" : formatLocale(), { month: "short", ...(withYear ? { year: "2-digit" } : {}), timeZone: "UTC" });
}
