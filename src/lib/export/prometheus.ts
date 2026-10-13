import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { serviceIds } from "../config/slug";
import { checkSpec } from "../checks";
import { DATA_DIR, db, incidentCountsSince, latestPing, openIncidents, uptimeSince } from "../db";
import { latestMetrics } from "../metrics";
import { certFor } from "../monitor";
import { backupStatus } from "../backup";
import { deviceStatuses, listDevices } from "../inventory/store";
import { savedStatus } from "../update/check";
import { buildInfo } from "../version";

/** A label value as the Prometheus text format wants it. */
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (l: Record<string, string>) => (Object.keys(l).length ? `{${Object.entries(l).map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}` : "");

interface Family {
  name: string;
  help: string;
  type: "gauge";
  samples: { labels: Record<string, string>; value: number }[];
}

const family = (name: string, help: string): Family => ({ name, help, type: "gauge", samples: [] });
/** A family with one unlabelled value. */
const single = (name: string, help: string, value: number): Family => ({ name, help, type: "gauge", samples: [{ labels: {}, value }] });

export function renderMetrics(families: Family[]): string {
  return (
    families
      .filter((f) => f.samples.length)
      .map((f) => [`# HELP ${f.name} ${f.help}`, `# TYPE ${f.name} ${f.type}`, ...f.samples.map((s) => `${f.name}${labels(s.labels)} ${Number.isFinite(s.value) ? s.value : "NaN"}`)].join("\n"))
      .join("\n") + "\n"
  );
}

/** One part of the export failing (no Docker socket, a missing table) must not empty the scrape. */
async function part(what: string, fn: () => Family[] | Promise<Family[]>): Promise<Family[]> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[nanodash] metrics export: ${what} skipped:`, (e as Error).message);
    return [];
  }
}

async function serviceFamilies(now: number): Promise<Family[]> {
  const { services } = await getConfig();
  const ids = serviceIds(services);
  const up = family("page_service_up", "1 when the service's last status check passed, 0 when it failed.");
  const latency = family("page_service_latency_ms", "Response time of the service's last status check, in milliseconds.");
  const uptime = family("page_service_uptime_ratio", "Share of the status checks that passed over the last 24 hours (0-1).");
  const checked = family("page_service_last_check_timestamp_seconds", "When the service was last checked (Unix time).");
  const cert = family("page_service_cert_days_left", "Days until the service's TLS certificate expires (negative once expired).");
  const incident = family("page_service_incident_open", "1 while the service is in an outage (down for alerts.threshold checks in a row).");
  const incidentStart = family("page_service_incident_started_timestamp_seconds", "When the service's current outage began (Unix time).");
  const incidents = family("page_service_incidents_24h", "Outages of the service that began in the last 24 hours.");
  const day = uptimeSince(now - 86_400_000);
  const open = new Map(openIncidents().map((i) => [i.service_id, i]));
  const outages = incidentCountsSince(now - 86_400_000);
  services.forEach((g, gi) =>
    g.services.forEach((s, si) => {
      if (!checkSpec(s)) return;
      const id = ids[gi][si];
      const l = { service: id, name: s.name, group: g.name };
      const last = latestPing(id);
      if (!last) return;
      up.samples.push({ labels: l, value: last.up ? 1 : 0 });
      if (last.latency_ms !== null) latency.samples.push({ labels: l, value: last.latency_ms });
      checked.samples.push({ labels: l, value: Math.round(last.ts / 1000) });
      const d = day.get(id);
      if (d?.checks) uptime.samples.push({ labels: l, value: Math.round((d.up / d.checks) * 10_000) / 10_000 });
      const c = certFor(id);
      if (c) cert.samples.push({ labels: l, value: c.daysLeft });
      const inc = open.get(id);
      incident.samples.push({ labels: l, value: inc ? 1 : 0 });
      if (inc) incidentStart.samples.push({ labels: l, value: Math.round(inc.start / 1000) });
      incidents.samples.push({ labels: l, value: outages.get(id) ?? 0 });
    }),
  );
  return [up, latency, uptime, checked, cert, incident, incidentStart, incidents];
}

async function deviceFamilies(): Promise<Family[]> {
  const devices = listDevices();
  const status = await deviceStatuses(devices);
  const up = family("page_device_up", "1 when the inventory device answered its last check (ping, or its TCP port), 0 when it did not.");
  const latency = family("page_device_latency_ms", "Response time of the inventory device's last check, in milliseconds.");
  for (const d of devices) {
    const s = status[d.id];
    if (!s) continue;
    const l = { device: String(d.id), name: d.name };
    up.samples.push({ labels: l, value: s.up ? 1 : 0 });
    if (s.latencyMs !== undefined) latency.samples.push({ labels: l, value: s.latencyMs });
  }
  return [up, latency];
}

function backupFamilies(): Family[] {
  const b = backupStatus();
  if (!b) return [];
  const out = [
    single("page_backup_last_run_timestamp_seconds", "When the last backup ran (Unix time).", Math.round(Date.parse(b.at) / 1000)),
    single("page_backup_last_ok", "1 when the last backup succeeded, 0 when it failed.", b.ok ? 1 : 0),
  ];
  if (b.ok && b.size !== undefined) out.push(single("page_backup_last_size_bytes", "Size of the last backup.", b.size));
  return out;
}

function instanceFamilies(now: number): Family[] {
  const count = (sql: string, ...args: number[]) => (db().prepare(sql).get(...args) as { n: number }).n;
  const out = [
    single("page_users", "Accounts that can sign in (not disabled).", count("SELECT COUNT(*) AS n FROM users WHERE disabled = 0")),
    single("page_sessions_active", "Sign-ins that have not expired or been revoked.", count("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?", now)),
    single("page_process_uptime_seconds", "Seconds since this process started.", Math.round(process.uptime())),
    single("page_process_resident_memory_bytes", "Resident memory of this process.", process.memoryUsage().rss),
  ];
  // The database plus its write-ahead log, which holds recent writes until the next checkpoint.
  const file = path.join(DATA_DIR, "page.db");
  const size = [file, `${file}-wal`].reduce((n, f) => n + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0);
  if (size) out.push(single("page_database_size_bytes", "Size of the database on disk, write-ahead log included.", size));
  return out;
}

/**
 * NanoDash's numbers for Prometheus: every checked service's state, latency, 24-hour uptime, certificate
 * and outages; inventory devices; the latest recorded widget values; backups, updates and the instance itself.
 */
export async function collectMetrics(now = Date.now()): Promise<string> {
  const { settings } = await getConfig();
  const widget = family("page_widget_value", "Latest recorded value of a widget field (widgets with record: true or thresholds).");
  for (const m of latestMetrics(now - 3_600_000)) widget.samples.push({ labels: { service: m.service_id, field: m.key }, value: m.value });
  const info: Family = { name: "page_build_info", help: "The running version of NanoDash.", type: "gauge", samples: [{ labels: { version: buildInfo().version }, value: 1 }] };
  return renderMetrics([
    ...(await part("services", () => serviceFamilies(now))),
    widget,
    ...(await part("devices", deviceFamilies)),
    ...(await part("backup", backupFamilies)),
    ...(await part("update", () => [single("page_update_available", "1 when a newer version than the running one is known.", savedStatus(settings.updates).available ? 1 : 0)])),
    ...(await part("instance", () => instanceFamilies(now))),
    info,
  ]);
}
