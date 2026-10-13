import { getConfig } from "./config";
import { serviceIds } from "./config/slug";
import { serviceVisibility } from "./config/sanitize";
import type { ServiceGroup, Settings } from "./config/schema";
import { checkSpec } from "./checks";
import { hourlyChecksSince, incidentsOverlapping, latestPing } from "./db";
import { localDay } from "./day";
import { listMutes, mutedNow } from "./maintenance";

/**
 * The public status page (/status): names, state, uptime and outage times only. Never links,
 * addresses, check targets, causes or widget data: it is readable without signing in.
 */
export interface StatusDay {
  /** YYYY-MM-DD, server local time. */
  day: string;
  /** Share of checks that passed that day; null without checks. */
  uptime: number | null;
}

export interface StatusService {
  name: string;
  group: string;
  /** null: not checked yet. */
  up: boolean | null;
  /** Alerts are held back (maintenance). */
  maintenance: boolean;
  /** The public message of that maintenance, when one was written. */
  note?: string;
  /** Over the whole period; null without checks. */
  uptime: number | null;
  days: StatusDay[];
}

export interface StatusIncident {
  service: string;
  start: number;
  end: number | null;
  planned: boolean;
  /** The public message of the maintenance it began in. */
  note?: string;
}

export interface StatusPageData {
  services: StatusService[];
  incidents: StatusIncident[];
  down: number;
  at: number;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Which services the page shows: only ones with a status check. With `listed`, exactly those ids
 * (so a hidden service can be put on it on purpose); otherwise the ones anyone may see.
 */
export function pickServices(groups: ServiceGroup[], listed?: string[], names: Record<string, string> = {}): { id: string; name: string; group: string }[] {
  const ids = serviceIds(groups);
  const out: { id: string; name: string; group: string }[] = [];
  groups.forEach((g, gi) =>
    g.services.forEach((s, si) => {
      if (!checkSpec(s)) return;
      const id = ids[gi][si];
      const shown = listed?.length ? listed.includes(id) : serviceVisibility(g, s).every((v) => v === "public");
      if (shown) out.push({ id, name: names[id]?.trim() || s.name, group: g.name });
    }),
  );
  return out;
}

/** The last `count` calendar days ending today, oldest first. */
export function lastDays(count: number, now: Date): string[] {
  return Array.from({ length: count }, (_, i) => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (count - 1 - i))));
}

/** Hourly check counts → one uptime per calendar day, for the given days. */
export function dailyUptime(rows: { hour: number; checks: number; up: number }[], days: string[]): { days: StatusDay[]; uptime: number | null } {
  const byDay = new Map<string, { checks: number; up: number }>();
  for (const r of rows) {
    const key = localDay(new Date(r.hour));
    const d = byDay.get(key) ?? { checks: 0, up: 0 };
    d.checks += r.checks;
    d.up += r.up;
    byDay.set(key, d);
  }
  let checks = 0;
  let up = 0;
  const out = days.map((day) => {
    const d = byDay.get(day);
    if (!d?.checks) return { day, uptime: null };
    checks += d.checks;
    up += d.up;
    return { day, uptime: d.up / d.checks };
  });
  return { days: out, uptime: checks ? up / checks : null };
}

export async function statusPageData(cfg: Settings["statusPage"], now = new Date()): Promise<StatusPageData> {
  const { services: groups, settings } = await getConfig();
  const picked = pickServices(groups, cfg.services, cfg.names);
  const days = lastDays(cfg.days, now);
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (cfg.days - 1)).getTime();
  const hours = hourlyChecksSince(since, Math.floor(now.getTime() / HOUR) * HOUR - 3 * HOUR);
  const mutes = listMutes(now.getTime());
  const names = new Map(picked.map((p) => [p.id, p.name]));

  const services = picked.map((p): StatusService => {
    const last = latestPing(p.id);
    const muted = mutedNow(settings.maintenance, mutes, p.id, now);
    return {
      name: p.name,
      group: p.group,
      up: last ? !!last.up : null,
      maintenance: !!muted,
      // Only the public message: the note for admins never leaves the dashboard.
      note: muted?.publicNote,
      ...dailyUptime(hours.get(p.id) ?? [], days),
    };
  });
  const incidents = incidentsOverlapping(now.getTime() - cfg.incidentDays * DAY)
    .filter((i) => names.has(i.service_id))
    .map((i) => ({ service: names.get(i.service_id)!, start: i.start, end: i.end, planned: !!i.planned, note: i.public_note ?? undefined }));
  return { services, incidents, down: services.filter((s) => s.up === false).length, at: now.getTime() };
}
