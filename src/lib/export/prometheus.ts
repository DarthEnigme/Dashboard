import { listRecurring, monthlyCents, nextOccurrence } from "../finance/recurring";
import fs from "node:fs";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import path from "node:path";
import { getConfig } from "../config";
import { serviceIds } from "../config/slug";
import { checkSpec } from "../checks";
import { DATA_DIR, db, incidentCountsSince, latestPing, openIncidents, uptimeSince } from "../db";
import { latestMetrics } from "../metrics";
import { certFor } from "../monitor";
import { listMaintenance, listMutes, quietNow } from "../maintenance";
import { backupStatus, listBackups } from "../backup";
import { cached } from "../cache";
import { loadConfig } from "../config/load";
import { localDay } from "../day";
import { listAccounts, withBalances } from "../finance/accounts";
import { summarize } from "../finance/aggregate";
import { listGoals } from "../finance/goals";
import { ratesForSummary } from "../finance/rates";
import { allForSummary, listCategories } from "../finance/store";
import { counters, gauges } from "../stats";
import { deviceStatuses, listDevices } from "../inventory/store";
import { savedStatus } from "../update/check";
import { buildInfo } from "../version";

/** A label value as the Prometheus text format wants it. */
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (l: Record<string, string>) => (Object.keys(l).length ? `{${Object.entries(l).map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}` : "");

interface Family {
  name: string;
  help: string;
  type: "gauge" | "counter";
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

/** A family from what lib/stats.ts has counted or last seen under the same name. */
const counted = (name: string, help: string): Family => ({ name, help, type: "counter", samples: counters(name) });
const seen = (name: string, help: string): Family => ({ name, help, type: "gauge", samples: gauges(name) });

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
  const { services, settings } = await getConfig();
  const ids = serviceIds(services);
  const up = family("page_service_up", "1 when the service's last status check passed, 0 when it failed.");
  const latency = family("page_service_latency_ms", "Response time of the service's last status check, in milliseconds.");
  const uptime = family("page_service_uptime_ratio", "Share of the status checks that passed over the last 24 hours (0-1); failures during maintenance are left out.");
  const checked = family("page_service_last_check_timestamp_seconds", "When the service was last checked (Unix time).");
  const cert = family("page_service_cert_days_left", "Days until the service's TLS certificate expires (negative once expired).");
  const incident = family("page_service_incident_open", "1 while the service is in an outage (down for alerts.threshold checks in a row).");
  const incidentStart = family("page_service_incident_started_timestamp_seconds", "When the service's current outage began (Unix time).");
  const incidents = family("page_service_incidents_24h", "Outages of the service that began in the last 24 hours.");
  const maintenance = family("page_service_maintenance", "1 while the service is in planned maintenance (a recurring window or a one-off).");
  const muted = family("page_service_alerts_muted", "1 while the service's notifications are muted (alerts only; the service is not in maintenance).");
  const mutes = listMutes(now);
  const oneoffs = listMaintenance(now);
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
      const q = quietNow(settings.maintenance, mutes, oneoffs, id, new Date(now));
      maintenance.samples.push({ labels: l, value: q.maintenance ? 1 : 0 });
      muted.samples.push({ labels: l, value: q.muted ? 1 : 0 });
    }),
  );
  return [up, latency, uptime, checked, cert, incident, incidentStart, incidents, maintenance, muted];
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

// Event-loop delay since the previous scrape; started with the first one.
const g = globalThis as typeof globalThis & { __pageLoopDelay?: IntervalHistogram };
function loopLagSeconds(): number {
  if (!g.__pageLoopDelay) {
    g.__pageLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    g.__pageLoopDelay.enable();
    return 0;
  }
  const mean = g.__pageLoopDelay.mean / 1e9;
  g.__pageLoopDelay.reset();
  return Number.isFinite(mean) ? Math.round(mean * 1e6) / 1e6 : 0;
}

const TABLES = ["pings", "pings_hourly", "metrics", "metrics_hourly", "incidents", "audit", "sessions", "users", "config_versions", "fin_transactions", "devices"];

/** How NanoDash itself is doing: its own work, its process, what it stores. */
async function internalFamilies(): Promise<Family[]> {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const backups = listBackups();
  // Counting rows walks an index: fine every few minutes, wasteful on every scrape.
  const rows = await cached("export|table-rows", 300_000, async () =>
    TABLES.flatMap((table) => {
      try {
        return [{ labels: { table }, value: (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n }];
      } catch {
        return []; // a table that isn't created until its feature is used
      }
    }),
  );
  const checked = savedStatus(loadConfig().settings.updates).checkedAt;
  return [
    seen("page_widget_fetch_ok", "1 when the widget's last fetch from its service worked, 0 when it failed."),
    seen("page_widget_fetch_duration_ms", "How long the widget's last fetch took, in milliseconds."),
    counted("page_widget_fetch_errors_total", "Widget fetches that failed."),
    counted("page_alerts_sent_total", "Alerts and notices delivered, per channel."),
    counted("page_alerts_failed_total", "Alerts and notices a channel did not accept (after one retry), per channel."),
    counted("page_checks_total", "Status checks run, by result."),
    seen("page_monitor_pass_duration_ms", "How long the last round of status checks took, in milliseconds."),
    seen("page_monitor_last_pass_timestamp_seconds", "When the last round of status checks finished (Unix time)."),
    counted("page_logins_total", "Successful sign-ins."),
    counted("page_login_failures_total", "Failed sign-ins (wrong password or code)."),
    single("page_config_errors", "Config files that could not be read or are not valid.", loadConfig().errors.length),
    { name: "page_process_cpu_seconds_total", help: "CPU time this process has used, user and system.", type: "counter", samples: [{ labels: {}, value: Math.round((cpu.user + cpu.system) / 1e4) / 100 }] },
    single("page_nodejs_heap_used_bytes", "JavaScript heap in use.", mem.heapUsed),
    single("page_nodejs_heap_total_bytes", "JavaScript heap reserved.", mem.heapTotal),
    single("page_nodejs_eventloop_lag_seconds", "Mean event-loop delay since the previous scrape.", loopLagSeconds()),
    { name: "page_table_rows", help: "Rows per database table (refreshed every 5 minutes).", type: "gauge", samples: rows },
    single("page_backups", "Backups on disk.", backups.length),
    single("page_backups_size_bytes", "Total size of the backups on disk.", backups.reduce((n, b) => n + b.size, 0)),
    ...(checked ? [single("page_update_last_check_timestamp_seconds", "When NanoDash last looked for a new version (Unix time).", Math.round(Date.parse(checked) / 1000))] : []),
  ];
}

/** Personal finance, only when finance.exportMetrics is on. Amounts are in units of the currency, not cents. */
async function financeFamilies(now: number): Promise<Family[]> {
  const { finance } = loadConfig().settings;
  if (!finance.exportMetrics) return [];
  const currency = finance.currency.toUpperCase();
  const today = localDay(new Date(now));
  const accounts = listAccounts().filter((a) => !a.archived);
  const rates = new Map<string, Record<string, number> | undefined>();
  for (const c of new Set(accounts.map((a) => a.currency))) rates.set(c, (await ratesForSummary(c))?.rates);
  const s = summarize(allForSummary(), listCategories(), today.slice(0, 7), currency, (await ratesForSummary(currency))?.rates);
  const balance = family("page_finance_account_balance", "Balance of each account, in its own currency.");
  for (const a of withBalances(accounts, (c) => rates.get(c), today)) balance.samples.push({ labels: { account: a.name, currency: a.currency }, value: a.balance / 100 });
  const budget = family("page_finance_budget_used_ratio", "Share of each category's monthly budget spent so far this month (1 = used up).");
  for (const b of s.budgets) budget.samples.push({ labels: { category: b.name }, value: b.budget ? Math.round((b.spent / b.budget) * 1000) / 1000 : 0 });
  const saved = family("page_finance_goal_saved", "Put aside for each savings goal.");
  const target = family("page_finance_goal_target", "Target of each savings goal.");
  for (const goal of listGoals()) {
    saved.samples.push({ labels: { goal: goal.name, currency: goal.currency }, value: goal.saved / 100 });
    target.samples.push({ labels: { goal: goal.name, currency: goal.currency }, value: goal.target / 100 });
  }
  const subs = family("page_finance_subscription_monthly_cost", "Average monthly cost of each running subscription, in its own currency.");
  for (const r of listRecurring()) {
    if (!r.subscription || !r.active || !nextOccurrence(r)) continue;
    subs.samples.push({ labels: { subscription: r.description, currency: r.currency }, value: monthlyCents(r) / 100 });
  }
  return [
    balance,
    subs,
    { name: "page_finance_month_income", help: "Income so far this month, in the finance currency.", type: "gauge", samples: [{ labels: { currency }, value: s.income / 100 }] },
    { name: "page_finance_month_spending", help: "Spending so far this month, in the finance currency.", type: "gauge", samples: [{ labels: { currency }, value: Math.abs(s.expense) / 100 }] },
    budget,
    saved,
    target,
  ];
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
    ...(await part("internals", internalFamilies)),
    ...(await part("finance", () => financeFamilies(now))),
    info,
  ]);
}
