import { getConfig } from "./config";
import { serviceIds } from "./config/slug";
import { serviceVisibility } from "./config/sanitize";
import type { ServiceGroup, Settings } from "./config/schema";
import { checkSpec } from "./checks";
import { hourlyChecksSince, incidentsOverlapping, latestPing } from "./db";
import { localDay } from "./day";
import { ALL, listMaintenance, maintenanceNow, nextWindowStart } from "./maintenance";
import { listIncidents, type Impact, type IncidentStatus } from "./statusIncidents";

/**
 * The public status page (/status): names, state, uptime and outage times only. Never links,
 * addresses, check targets, causes or widget data: it is readable without signing in.
 */
export interface StatusDay {
  /** YYYY-MM-DD, server local time. */
  day: string;
  /** Share of checks that passed that day (failures during maintenance left out); null without checks. */
  uptime: number | null;
}

export interface StatusService {
  name: string;
  group: string;
  /** null: not checked yet. */
  up: boolean | null;
  /** Planned maintenance is under way (a mere mute of alerts is not shown here). */
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

/** An incident an admin posted, as visitors see it (no author). */
export interface StatusPosted {
  id: number;
  title: string;
  status: IncidentStatus;
  impact: Impact;
  /** Names of the services on this page it is about; empty: not about one in particular. */
  services: string[];
  start: number;
  end: number | null;
  /** Newest first. */
  updates: { status: IncidentStatus; body: string; at: number }[];
}

/** Planned maintenance still to come. */
export interface StatusUpcoming {
  start: number;
  end: number | null;
  /** Names of the services on this page; empty: all of them. */
  services: string[];
  name?: string;
  note?: string;
}

export interface StatusPageData {
  services: StatusService[];
  incidents: StatusIncident[];
  posted: StatusPosted[];
  upcoming: StatusUpcoming[];
  down: number;
  at: number;
}

const UPCOMING_DAYS = 7;

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
  const oneoffs = listMaintenance(now.getTime());
  const names = new Map(picked.map((p) => [p.id, p.name]));

  const services = picked.map((p): StatusService => {
    const last = latestPing(p.id);
    const maint = maintenanceNow(settings.maintenance, oneoffs, p.id, now);
    return {
      name: p.name,
      group: p.group,
      up: last ? !!last.up : null,
      maintenance: !!maint,
      // Only the public message: the note for admins never leaves the dashboard.
      note: maint?.publicNote,
      ...dailyUptime(hours.get(p.id) ?? [], days),
    };
  });
  const incidents = incidentsOverlapping(now.getTime() - cfg.incidentDays * DAY)
    .filter((i) => names.has(i.service_id))
    .map((i) => ({ service: names.get(i.service_id)!, start: i.start, end: i.end, planned: !!i.planned, note: i.public_note ?? undefined }));
  // Only what concerns services on this page (or no service in particular), and never who wrote it.
  const shownNames = (ids: string[]) => ids.filter((id) => id === ALL || names.has(id)).map((id) => (id === ALL ? "" : names.get(id)!)).filter(Boolean);
  const onPage = (ids: string[]) => !ids.length || ids.includes(ALL) || ids.some((id) => names.has(id));
  const posted = cfg.showPosted
    ? listIncidents(now.getTime() - cfg.incidentDays * DAY)
        .filter((i) => onPage(i.services))
        .map((i) => ({ id: i.id, title: i.title, status: i.status, impact: i.impact, services: shownNames(i.services), start: i.created_at, end: i.resolved_at, updates: i.updates.map(({ status, body, at }) => ({ status, body, at })) }))
    : [];
  const until = now.getTime() + UPCOMING_DAYS * DAY;
  const upcoming: StatusUpcoming[] = cfg.showUpcoming
    ? [
        ...listMaintenance(now.getTime())
          .filter((m) => m.start > now.getTime() && m.start <= until && onPage([m.service]))
          .map((m) => ({ start: m.start, end: m.end, services: shownNames([m.service]), note: m.publicNote })),
        ...settings.maintenance.flatMap((w) => {
          const next = nextWindowStart(w, now, UPCOMING_DAYS);
          if (!next || !onPage(w.services ?? [])) return [];
          return [{ start: next.start, end: next.end, services: shownNames(w.services ?? []), name: w.name, note: w.publicNote }];
        }),
      ].sort((a, b) => a.start - b.start)
    : [];
  return { services, incidents, posted, upcoming, down: services.filter((s) => s.up === false && !s.maintenance).length, at: now.getTime() };
}
