/** Tasks that repeat: when the next one is due. Pure, so the store and the page share it. */

export const REPEAT_UNITS = ["day", "week", "month"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export interface Repeat {
  /** 1 to 365. */
  every: number;
  unit: RepeatUnit;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** `day` moved on by `n` units; a month keeps the day of the month, or the last day of a shorter month (Jan 31 → Feb 28). */
export function addUnits(day: string, n: number, unit: RepeatUnit): string {
  const t = Date.parse(day);
  if (unit === "day") return iso(t + n * DAY);
  if (unit === "week") return iso(t + n * 7 * DAY);
  const d = new Date(t);
  const months = d.getUTCMonth() + n;
  const year = d.getUTCFullYear() + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return iso(Date.UTC(year, month, Math.min(d.getUTCDate(), last)));
}

/**
 * The next one's due date: the last due date moved on by the repeat, as many times as needed to not
 * be in the past (a weekly chore finished late is due next week, not last week). Without a due date,
 * it counts from `today`. Each step counts from the first date, so months don't drift (31st, 28th, 31st).
 */
export function nextDue(due: string | null, repeat: Repeat, today: string): string {
  const from = due ?? today;
  for (let k = 1; ; k++) {
    const next = addUnits(from, k * repeat.every, repeat.unit);
    if (next >= today || k > 10_000) return next;
  }
}
