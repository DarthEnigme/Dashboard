const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A moment as a calendar date (YYYY-MM-DD) where this runs: the server's time zone (TZ) on the
 * server, the visitor's in the browser. "Today" must not flip at midnight UTC for someone in Tokyo.
 */
export const localDay = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The calendar day `n` days before `day` (both YYYY-MM-DD). */
export const daysBefore = (day: string, n: number) => new Date(Date.parse(day) - n * 86_400_000).toISOString().slice(0, 10);

/** A YYYY-MM-DD day as a local date (not midnight UTC, which is the day before west of Greenwich). */
export const asLocal = (day: string) => new Date(`${day}T00:00`);
