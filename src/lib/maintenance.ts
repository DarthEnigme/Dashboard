import { getAppMeta, setAppMeta } from "./db";
import { weekdays, type Settings } from "./config/schema";

/**
 * Two separate ways to quiet a service; checks keep running and history is kept in both.
 * - A mute only holds back notifications. Nothing changes for visitors: outages show and count as usual.
 * - Maintenance is planned work: alerts are held back too, outages that start meanwhile are recorded
 *   as planned and left out of uptime, and the status page says so. Recurring windows live in
 *   settings.yaml; one-off ones (now, or scheduled) are set from the dashboard.
 */
export type MaintenanceWindow = Settings["maintenance"][number];

/** A one-off mute; `until` null lasts until someone turns alerts back on. */
export interface Mute {
  until: number | null;
  by: string | null;
  at: number;
  /** Why, for admins. */
  note?: string;
}
/** Keyed by service id; ALL mutes every service. */
export type Mutes = Record<string, Mute>;
export const ALL = "*";

/** One-off maintenance, from `start` to `end` (null: until someone ends it). */
export interface Maintenance {
  id: string;
  /** A service id, or ALL. */
  service: string;
  start: number;
  end: number | null;
  by: string | null;
  at: number;
  /** For admins. */
  note?: string;
  /** What visitors of the status page may read. */
  publicNote?: string;
}

const MUTES = "maintenance.mutes";
const ONEOFF = "maintenance.oneoff";
// Read on every tile refresh, written a few times a year: kept in memory (one process owns the database).
const g = globalThis as typeof globalThis & { __pageMutes?: Mutes; __pageMaint?: Maintenance[] };
const storedMutes = () => (g.__pageMutes ??= getAppMeta<Mutes>(MUTES) ?? {});
const storeMutes = (m: Mutes) => {
  g.__pageMutes = m;
  setAppMeta(MUTES, m);
};
const storedMaint = () => (g.__pageMaint ??= getAppMeta<Maintenance[]>(ONEOFF) ?? []);
const storeMaint = (m: Maintenance[]) => {
  g.__pageMaint = m;
  setAppMeta(ONEOFF, m);
};
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const text = (s: string | undefined) => s?.trim().slice(0, 200) || undefined;

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

const covers = (services: string[] | undefined, id: string) => !services?.length || services.includes(id) || services.includes(ALL);

// --- mutes ---

/** The mutes still in force. */
export function listMutes(now = Date.now()): Mutes {
  return Object.fromEntries(Object.entries(storedMutes()).filter(([, m]) => m.until === null || m.until > now));
}

/** Mute a service (or ALL) for `minutesFor` minutes, or until turned back on (null). */
export function mute(target: string, minutesFor: number | null, by: string | null, now = Date.now(), notes: { note?: string } = {}): Mutes {
  const next = { ...listMutes(now), [target]: { until: minutesFor === null ? null : now + minutesFor * 60_000, by, at: now, note: text(notes.note) } };
  storeMutes(next);
  return next;
}

export function unmute(target: string, now = Date.now()): Mutes {
  const next = listMutes(now);
  delete next[target];
  storeMutes(next);
  return next;
}

export interface Muted {
  /** When alerts come back, if known. */
  until?: number;
  /** True when it comes from a mute of every service. */
  all?: boolean;
  note?: string;
}

/** Why this service's notifications are muted right now, or undefined when they are not. */
export function mutedNow(mutes: Mutes, id: string, now = new Date()): Muted | undefined {
  const own = mutes[id];
  const m = own ?? mutes[ALL];
  if (!m || (m.until !== null && m.until <= now.getTime())) return undefined;
  return { ...(m.until === null ? {} : { until: m.until }), ...(own ? {} : { all: true }), ...(m.note ? { note: m.note } : {}) };
}

// --- one-off maintenance ---

/** One-off maintenance that is going on or still to come. */
export function listMaintenance(now = Date.now()): Maintenance[] {
  return storedMaint().filter((m) => m.end === null || m.end > now);
}

/** Plan maintenance of a service (or ALL) from `start` to `end` (null: until ended by hand). */
export function startMaintenance(
  service: string,
  start: number,
  end: number | null,
  by: string | null,
  now = Date.now(),
  notes: { note?: string; publicNote?: string } = {},
): Maintenance {
  const m: Maintenance = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, service, start, end, by, at: now, note: text(notes.note), publicNote: text(notes.publicNote) };
  storeMaint([...listMaintenance(now), m]);
  return m;
}

/** End maintenance that is under way, or drop one that has not started yet. */
export function endMaintenance(id: string, now = Date.now()): boolean {
  const list = listMaintenance(now);
  const m = list.find((x) => x.id === id);
  if (!m) return false;
  storeMaint(m.start > now ? list.filter((x) => x !== m) : list.map((x) => (x === m ? { ...x, end: now } : x)));
  return true;
}

export interface InMaintenance {
  /** One-off: its id, and when it ends if known. */
  id?: string;
  until?: number;
  /** The window's name, for recurring ones. */
  window?: string;
  note?: string;
  publicNote?: string;
}

/** The maintenance this service is in right now, or undefined. One-off maintenance wins over a window. */
export function maintenanceNow(windows: MaintenanceWindow[], oneoffs: Maintenance[], id: string, now = new Date()): InMaintenance | undefined {
  const t = now.getTime();
  const notes = (x: { note?: string; publicNote?: string }) => ({ ...(x.note ? { note: x.note } : {}), ...(x.publicNote ? { publicNote: x.publicNote } : {}) });
  const m = oneoffs.find((x) => (x.service === id || x.service === ALL) && x.start <= t && (x.end === null || x.end > t));
  if (m) return { id: m.id, ...(m.end === null ? {} : { until: m.end }), ...notes(m) };
  const w = windows.find((x) => covers(x.services, id) && inWindow(x, now));
  return w ? { window: w.name ?? `${w.from}–${w.to}`, ...notes(w) } : undefined;
}

/** Both at once, for the many places that show or act on them. */
export function quietNow(windows: MaintenanceWindow[], mutes: Mutes, oneoffs: Maintenance[], id: string, now = new Date()) {
  const muted = mutedNow(mutes, id, now);
  const maintenance = maintenanceNow(windows, oneoffs, id, now);
  /** Alerts are held back in both cases. */
  return { muted, maintenance, held: !!(muted || maintenance) };
}

/**
 * When a recurring window next starts after `now` (server local time), within `days`, with its
 * end; undefined if it doesn't start in that time.
 */
export function nextWindowStart(w: Pick<MaintenanceWindow, "days" | "from" | "to">, now: Date, days = 7): { start: number; end: number } | undefined {
  const from = minutes(w.from);
  const to = minutes(w.to);
  for (let d = 0; d <= days; d++) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, Math.floor(from / 60), from % 60);
    if (start.getTime() <= now.getTime()) continue;
    if (w.days?.length && !w.days.includes(weekdays[start.getDay()])) continue;
    // Equal times mean the whole day; an end before the start is the next day.
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (to <= from ? 1 : 0), Math.floor(to / 60), to % 60);
    return { start: start.getTime(), end: end.getTime() };
  }
  return undefined;
}
