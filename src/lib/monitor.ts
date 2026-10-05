import { getConfig } from "./config";
import { serviceIds } from "./config/slug";
import { closeIncident, getAppMeta, insertPing, openIncident, openIncidents, pingsBetween, pruneHistory, setAppMeta, unrolledHours, upsertHour } from "./db";
import { checkSpec, runCheck, type CertInfo, type PingResult } from "./checks";
import { evaluate, hasAlertChannel, sendAlert, sendNotice, type AlertState } from "./alerts";
import type { Service, Settings } from "./config/schema";
import { fetchWidget } from "./widgets";
import { describeRule, evaluateThreshold, numericValue, widgetExtras, type BreachState } from "./thresholds";
import { insertMetrics, pruneMetrics, rollupMetrics } from "./metrics";
import { RAW_RETENTION, rollupHour } from "./history";

const CONCURRENCY = 8;
const HOUR = 3_600_000;

interface MonitorState {
  timer?: NodeJS.Timeout;
  /** Outage state per service id (also drives incidents). */
  outages: Map<string, AlertState>;
  lastMaintenance: number;
  /** Extra jobs run hourly (e.g. finance sync), registered by other modules. */
  hourly: (() => Promise<void>)[];
  /** Latest certificate seen per service id (HTTPS checks). */
  certs: Map<string, CertInfo>;
  lastMetrics: number;
  /** Threshold state per "service id|field label". */
  breaches: Map<string, BreachState>;
}

/**
 * Read widgets that record history or have thresholds: store their numbers and alert when a
 * value stays past its limit (and again when it is back).
 */
async function recordMetrics(state: MonitorState, services: { id: string; service: Service }[], settings: Settings) {
  const now = Date.now();
  const alertsOn = hasAlertChannel(settings.alerts);
  await mapLimit(services, CONCURRENCY, async ({ id, service }) => {
    const extras = widgetExtras(service.widget);
    if (!extras.record && !extras.thresholds) return;
    let result;
    try {
      result = await fetchWidget(id, service);
    } catch {
      return; // the tile shows the error; nothing to record
    }
    if (extras.record) {
      const samples = result.fields.flatMap((f) => {
        const v = numericValue(f);
        return v === undefined ? [] : [{ key: f.label, value: v }];
      });
      if (samples.length) insertMetrics(id, now, samples);
    }
    for (const [label, rule] of Object.entries(extras.thresholds ?? {})) {
      const field = [...result.fields, ...(result.list ?? [])].find((f) => f.label.toLowerCase() === label.toLowerCase());
      const v = field ? numericValue(field) : undefined;
      if (v === undefined) continue;
      const key = `${id}|${label}`;
      const { state: next, event } = evaluateThreshold(state.breaches.get(key) ?? { firing: false }, v, rule, now);
      state.breaches.set(key, next);
      if (!event || !alertsOn || service.alert === false) continue;
      const errors = await sendNotice(settings.alerts, {
        kind: "threshold",
        level: event === "breach" ? "warn" : "info",
        message:
          event === "breach"
            ? `${service.name}: ${field!.label} is ${field!.value} (${describeRule(rule)}${rule.for ? ` for ${rule.for} min` : ""}).`
            : `${service.name}: ${field!.label} is back to ${field!.value}.`,
        url: service.href,
        service: service.name,
        field: field!.label,
        value: v,
        state: event,
      });
      if (errors.length) console.warn(`[page] threshold alert for ${service.name} failed: ${errors.join("; ")}`);
    }
  });
}

/** The certificate of a service's HTTPS check, as last seen by the monitor. */
export const certFor = (id: string): CertInfo | undefined => g.__pageMonitor?.certs.get(id);

/** Why a check failed, for incidents and alerts: the check's own reason beats the bare status. */
export const failureCause = (r: PingResult) => r.error ?? (r.status ? `HTTP ${r.status}` : "no response");

/** Once a day per service while a certificate is within `certDays` of expiring (or expired). */
async function certNotice(settings: Settings, id: string, service: Service, cert: CertInfo) {
  const days = settings.alerts.certDays;
  if (!days || cert.daysLeft > days || !hasAlertChannel(settings.alerts) || service.alert === false) return;
  const today = new Date().toISOString().slice(0, 10);
  const key = `cert.${id}`;
  if (getAppMeta<string>(key) === today) return;
  const when = cert.expires.slice(0, 10);
  const errors = await sendNotice(settings.alerts, {
    kind: "cert",
    level: cert.daysLeft < 0 ? "error" : "warn",
    message:
      cert.daysLeft < 0
        ? `${service.name}: the TLS certificate expired on ${when}.`
        : `${service.name}: the TLS certificate expires in ${cert.daysLeft} ${cert.daysLeft === 1 ? "day" : "days"} (${when}).`,
    url: service.href,
    service: service.name,
    expires: cert.expires,
    daysLeft: cert.daysLeft,
  });
  if (!errors.length) setAppMeta(key, today);
}

const g = globalThis as typeof globalThis & { __pageMonitor?: MonitorState };

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

/** Roll every finished hour of raw pings into pings_hourly. */
export function rollup(now = Date.now()) {
  const currentHour = Math.floor(now / HOUR) * HOUR;
  for (const { service_id, hour } of unrolledHours(currentHour)) {
    upsertHour({ service_id, hour, ...rollupHour(pingsBetween(service_id, hour, hour + HOUR)) });
  }
}

async function tick(state: MonitorState): Promise<number> {
  const cfg = await getConfig();
  const { settings } = cfg;
  const ids = serviceIds(cfg.services);
  const targets = cfg.services.flatMap((grp, gi) =>
    grp.services
      .map((s, si) => ({ id: ids[gi][si], service: s, check: checkSpec(s) }))
      .filter((t): t is typeof t & { check: NonNullable<typeof t.check> } => !!t.check),
  );
  const alertsOn = hasAlertChannel(settings.alerts);

  if (Date.now() - state.lastMetrics >= settings.metricsInterval * 1000 - 1000) {
    state.lastMetrics = Date.now();
    const widgets = cfg.services.flatMap((grp, gi) => grp.services.map((s, si) => ({ id: ids[gi][si], service: s }))).filter((t) => t.service.widget);
    await recordMetrics(state, widgets, settings).catch((e) => console.error("[page] recording metrics failed:", e));
  }

  await mapLimit(targets, CONCURRENCY, async ({ id, service, check }) => {
    const r = await runCheck(check);
    const now = r.at ?? Date.now();
    insertPing({ service_id: id, ts: now, up: r.up ? 1 : 0, status: r.status ?? null, latency_ms: r.latencyMs ?? null });
    if (r.cert) {
      state.certs.set(id, r.cert);
      await certNotice(settings, id, service, r.cert).catch((e) => console.warn(`[page] certificate notice for ${service.name} failed:`, e));
    }

    // Outages are always recorded as incidents; alerts are only sent when a channel is configured.
    const { state: next, event } = evaluate(state.outages.get(id) ?? { failures: 0, down: false }, r.up, settings.alerts.threshold, now);
    state.outages.set(id, next);
    if (!event) return;
    if (event.kind === "down") openIncident(id, event.since, failureCause(r));
    else closeIncident(id, now);

    if (!alertsOn || service.alert === false) return;
    const errors = await sendAlert(settings.alerts, {
      service: service.name,
      status: event.kind === "down" ? "down" : "up",
      url: service.href,
      since: new Date(event.since).toISOString(),
      durationSeconds: event.kind === "recovered" ? Math.round(event.durationMs / 1000) : undefined,
      error: r.error,
      httpStatus: r.error ? undefined : r.status,
    });
    if (errors.length) console.warn(`[page] alert for ${service.name} failed: ${errors.join("; ")}`);
  });

  if (Date.now() - state.lastMaintenance > HOUR) {
    state.lastMaintenance = Date.now();
    rollup();
    pruneHistory(Date.now() - RAW_RETENTION, Date.now() - settings.history.retentionDays * 24 * HOUR);
    try {
      rollupMetrics();
      pruneMetrics(Date.now() - RAW_RETENTION, Date.now() - settings.history.retentionDays * 24 * HOUR);
    } catch (e) {
      console.error("[page] metrics maintenance failed:", e);
    }
    for (const job of state.hourly) await job().catch((e) => console.error("[page] hourly job failed:", e));
  }
  return settings.pingInterval * 1000;
}

/** Register a job for the monitor's hourly maintenance pass. */
export function onHourly(job: () => Promise<void>) {
  startMonitor();
  g.__pageMonitor!.hourly.push(job);
}

/** Ping every service on the configured interval, store results, track incidents and fire alerts. Idempotent. */
export function startMonitor() {
  if (g.__pageMonitor) return;
  const state: MonitorState = { outages: new Map(), lastMaintenance: 0, hourly: [], certs: new Map(), lastMetrics: 0, breaches: new Map() };
  g.__pageMonitor = state;
  // Outages that were open when the server stopped stay open until the service is seen up again.
  try {
    for (const i of openIncidents()) state.outages.set(i.service_id, { failures: 1, down: true, since: i.start });
  } catch (e) {
    console.warn("[page] could not load open incidents:", e);
  }
  const loop = async () => {
    let delay = 30_000;
    try {
      delay = await tick(state);
    } catch (e) {
      console.error("[page] monitor tick failed:", e);
    }
    state.timer = setTimeout(loop, delay);
    state.timer.unref?.();
  };
  // Let the server finish booting first.
  state.timer = setTimeout(loop, 3000);
  state.timer.unref?.();
}
