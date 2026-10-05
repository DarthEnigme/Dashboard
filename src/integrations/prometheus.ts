import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult, WidgetSpark } from "./types";
import { formatMetric, metricField, metricFormats, sparkScale, thresholdSchema } from "./metrics";

export const promQuerySchema = z.object({
  label: z.string(),
  /** PromQL; should return one series (wrap in sum()/avg() if needed) or a scalar. */
  query: z.string().min(1),
  format: z.enum(metricFormats).default("number"),
  decimals: z.number().int().min(0).max(6).optional(),
  suffix: z.string().optional(),
  /** Also draw the last `range` of this query as a sparkline (tiles bigger than small). */
  chart: z.boolean().optional(),
  ...thresholdSchema,
});
export type PromQuery = z.infer<typeof promQuerySchema>;

export const promConnection = {
  url: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  /** Bearer token (e.g. Grafana Cloud / Mimir), instead of basic auth. */
  token: z.string().optional(),
  /** Extra headers, e.g. X-Scope-OrgID for Mimir/Thanos tenants. */
  headers: z.record(z.string()).optional(),
  insecure: z.boolean().optional(),
};

const schema = z.object({
  ...promConnection,
  queries: z.array(promQuerySchema).default([]),
  /** Show scrape targets up/down, with failing targets listed on large tiles. */
  targets: z.boolean().optional(),
  /** Sparkline window, e.g. 1h, 6h, 30m. */
  range: z.string().regex(/^\d+[smhd]$/, "like 30m, 1h or 6h").default("1h"),
});

interface PromResponse<T> {
  status: "success" | "error";
  data: T;
  error?: string;
}
type Sample = [number, string];
export interface PromInstant {
  resultType: "vector" | "scalar" | "matrix" | "string";
  result: { metric: Record<string, string>; value: Sample }[] | Sample;
}
export interface PromRange {
  resultType: "matrix";
  result: { metric: Record<string, string>; values: Sample[] }[];
}
export interface PromTarget {
  health: "up" | "down" | "unknown";
  labels: Record<string, string>;
  scrapeUrl?: string;
  lastError?: string;
}

/** The single number an instant query returns (first series of a vector, or a scalar). */
export function instantValue(data: PromInstant): number | undefined {
  if (data.resultType === "scalar" || data.resultType === "string") {
    const [, v] = data.result as Sample;
    return Number(v);
  }
  const first = (data.result as { value: Sample }[])[0];
  return first ? Number(first.value[1]) : undefined;
}

export function rangeValues(data: PromRange): number[] {
  return (data.result[0]?.values ?? []).map(([, v]) => Number(v)).filter(Number.isFinite);
}

const seconds = (r: string) => Number(r.slice(0, -1)) * { s: 1, m: 60, h: 3600, d: 86400 }[r.slice(-1) as "s"];

export function parseTargets(targets: PromTarget[]): { field: WidgetField; down: WidgetField[] } {
  const up = targets.filter((t) => t.health === "up").length;
  const bad = targets.filter((t) => t.health !== "up");
  return {
    field: { label: "Targets", value: `${up} / ${targets.length}`, status: bad.length ? "error" : "ok" },
    down: bad.map((t) => ({ label: `${t.labels.job ?? "?"} · ${t.labels.instance ?? t.scrapeUrl ?? ""}`, value: t.health, status: "error" })),
  };
}

export function parsePrometheus(
  queries: PromQuery[],
  values: (number | undefined)[],
  series: (number[] | undefined)[],
  targets?: PromTarget[],
): WidgetResult {
  const fields = queries.map((q, i) => metricField(q.label, values[i], q));
  const sparks: WidgetSpark[] = [];
  queries.forEach((q, i) => {
    const s = series[i];
    if (!q.chart || !s?.length) return;
    const { unit, max, scale } = sparkScale(q.format);
    sparks.push({ label: q.label, values: s.map((v) => v * scale), current: formatMetric(values[i], q.format, q.decimals), unit, max });
  });
  const result: WidgetResult = { fields };
  if (targets) {
    const t = parseTargets(targets);
    fields.push(t.field);
    if (t.down.length) result.list = t.down;
  }
  if (sparks.length) result.sparks = sparks;
  return result;
}

export function promClient(cfg: { url: string; username?: string; password?: string; token?: string; headers?: Record<string, string>; insecure?: boolean }) {
  const headers: Record<string, string> = { ...cfg.headers };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  else if (cfg.username) headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ""}`).toString("base64")}`;
  const get = async <T,>(path: string, params: Record<string, string>) => {
    const res = await httpJson<PromResponse<T>>(`${trimSlash(cfg.url)}/api/v1/${path}?${new URLSearchParams(params)}`, { headers, insecure: cfg.insecure });
    if (res.status !== "success") throw new Error(res.error ?? "Prometheus query failed");
    return res.data;
  };
  return {
    instant: (query: string) => get<PromInstant>("query", { query }).then(instantValue),
    range: (query: string, range: string, points = 40) => {
      const end = Math.floor(Date.now() / 1000);
      const span = seconds(range);
      return get<PromRange>("query_range", { query, start: String(end - span), end: String(end), step: String(Math.max(Math.round(span / points), 1)) }).then(rangeValues);
    },
    targets: () => get<{ activeTargets: PromTarget[] }>("targets", { state: "active" }).then((d) => d.activeTargets),
  };
}

/** Prometheus (or any PromQL API: Thanos, Mimir, VictoriaMetrics): your own queries as fields and sparklines. */
export const prometheus: Integration<typeof schema> = {
  type: "prometheus",
  schema,
  async fetch(cfg) {
    const client = promClient(cfg);
    const [values, series, targets] = await Promise.all([
      Promise.all(cfg.queries.map((q) => client.instant(q.query).catch(() => undefined))),
      Promise.all(cfg.queries.map((q) => (q.chart ? client.range(q.query, cfg.range).catch(() => undefined) : undefined))),
      cfg.targets ? client.targets() : undefined,
    ]);
    if (cfg.queries.length && values.every((v) => v === undefined) && !targets) {
      // Every query failed: surface the first error instead of a row of dashes.
      await client.instant(cfg.queries[0].query);
    }
    if (!cfg.queries.length && !cfg.targets) return parsePrometheus([], [], [], await client.targets());
    return parsePrometheus(cfg.queries, values, series, targets);
  },
};
