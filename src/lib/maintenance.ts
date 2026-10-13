import { getAppMeta, setAppMeta } from "./db";
import { weekdays, type Settings } from "./config/schema";

/**
 * Maintenance: times when a service's alerts are held back. Checks keep running and history is
 * kept; an outage that starts meanwhile is recorded as planned.
 * Two kinds: recurring windows in settings.yaml, and one-off mutes set from the dashboard.
 */
export type MaintenanceWindow = Settings["maintenance"][number];

/** A one-off mute; `until` null lasts until someone turns alerts back on. */
export interface Mute {
  until: number | null;
  by: string | null;
  at: number;
  /** Why, for admins. */
  note?: string;
  /** What visitors of the status page may read. */
  publicNote?: string;
}
/** Keyed by service id; ALL mutes every service. */
export type Mutes = Record<string, Mute>;
export const ALL = "*";

const KEY = "maintenance.mutes";
// Read on every tile refresh, written a few times a year: kept in memory (one process owns the database).
const g = globalThis as typeof globalThis & { __pageMutes?: Mutes };
const stored = () => (g.__pageMutes ??= getAppMeta<Mutes>(KEY) ?? {});
const store = (m: Mutes) => {
  g.__pageMutes = m;
  setAppMeta(KEY, m);
};
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Is `now` (server local time) inside the window? `days` name the day a window starts on, so
 * "sat 23:00–02:00" covers the first two hours of Sunday. Equal times mean the whole day.
 */
export function inWindow(w: Pick<MaintenanceWindow, "days" | "from" | "to">, now: Date): boolean {
  const t = now.getHours() * 60 + now.getMinutes();
  const from = minutes(w.from);
  const to = minutes(w.to);
  const on = (day: number) => !w.days?.length || w.days.includes(weekdays[day]);
  const today = now.getDay();
  if (from < to) return t >= from && t < to && on(today);
  return (t >= from && on(today)) || (t < to && on((today + 6) % 7));
}

const covers = (w: MaintenanceWindow, id: string) => !w.services?.length || w.services.includes(id) || w.services.includes(ALL);

/** The mutes still in force. */
export function listMutes(now = Date.now()): Mutes {
  const all = stored();
  return Object.fromEntries(Object.entries(all).filter(([, m]) => m.until === null || m.until > now));
}

/** Mute a service (or ALL) for `minutesFor` minutes, or until turned back on (null). */
export function mute(target: string, minutesFor: number | null, by: string | null, now = Date.now(), notes: { note?: string; publicNote?: string } = {}): Mutes {
  const text = (s: string | undefined) => s?.trim().slice(0, 200) || undefined;
  const next = { ...listMutes(now), [target]: { until: minutesFor === null ? null : now + minutesFor * 60_000, by, at: now, note: text(notes.note), publicNote: text(notes.publicNote) } };
  store(next);
  return next;
}

export function unmute(target: string, now = Date.now()): Mutes {
  const next = listMutes(now);
  delete next[target];
  store(next);
  return next;
}

export interface Muted {
  /** When alerts come back, if known (a one-off mute with an end). */
  until?: number;
  /** The window's name, for recurring ones. */
  window?: string;
  note?: string;
  publicNote?: string;
}

/** Why this service's alerts are held back right now, or undefined when they are not. */
export function mutedNow(windows: MaintenanceWindow[], mutes: Mutes, id: string, now = new Date()): Muted | undefined {
  const m = mutes[id] ?? mutes[ALL];
  const notes = (x: { note?: string; publicNote?: string }) => ({ ...(x.note ? { note: x.note } : {}), ...(x.publicNote ? { publicNote: x.publicNote } : {}) });
  if (m && (m.until === null || m.until > now.getTime())) return { ...(m.until === null ? {} : { until: m.until }), ...notes(m) };
  const w = windows.find((x) => covers(x, id) && inWindow(x, now));
  return w ? { window: w.name ?? `${w.from}–${w.to}`, ...notes(w) } : undefined;
}
