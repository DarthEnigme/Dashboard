import type { Trip } from "./store";

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

export type TripCountdown = { trip: Trip; ongoing: true; day: number; length: number } | { trip: Trip; ongoing: false; inDays: number };

/** The trip under way today, or else the next one to start; null when none is planned. Client-safe. */
export function nextTrip(trips: Trip[], today: string): TripCountdown | null {
  const now = trips.filter((t) => t.start_date <= today && t.end_date >= today).sort((a, b) => a.end_date.localeCompare(b.end_date))[0];
  if (now) return { trip: now, ongoing: true, day: days(now.start_date, today) + 1, length: days(now.start_date, now.end_date) + 1 };
  const next = trips.filter((t) => t.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  return next ? { trip: next, ongoing: false, inDays: days(today, next.start_date) } : null;
}
