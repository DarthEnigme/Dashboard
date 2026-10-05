import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult, WidgetSpark } from "./types";
import { getPath } from "./customapi";
import { formatMetric, metricField, metricFormats, sparkScale, thresholdSchema } from "./metrics";

const metricSchema = z.object({
  label: z.string(),
  /** json: a path into the response ("data.cpu", "hosts[0].load"). */
  path: z.string().optional(),
  /** influxdb: a Flux query; the last _value of the result is used. */
  query: z.string().optional(),
  format: z.enum(metricFormats).default("number"),
  decimals: z.number().int().min(0).max(6).optional(),
  suffix: z.string().optional(),
  /** influxdb: draw all returned values as a sparkline. json: path to an array of numbers. */
  chart: z.union([z.boolean(), z.string()]).optional(),
  ...thresholdSchema,
});
type Metric = z.infer<typeof metricSchema>;

const schema = z.object({
  source: z.enum(["json", "influxdb"]).default("json"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  /** influxdb: API token and organisation. */
  token: z.string().optional(),
  org: z.string().optional(),
  insecure: z.boolean().optional(),
  metrics: z.array(metricSchema).min(1),
});

export function parseJsonMetrics(data: unknown, metrics: Metric[]): WidgetResult {
  const sparks: WidgetSpark[] = [];
  const fields = metrics.map((m) => {
    const raw = m.path ? getPath(data, m.path) : undefined;
    const v = typeof raw === "number" || typeof raw === "string" ? raw : raw === undefined || raw === null ? undefined : JSON.stringify(raw);
    if (typeof m.chart === "string") {
      const arr = getPath(data, m.chart);
      if (Array.isArray(arr)) pushSpark(sparks, m, arr.map(Number).filter(Number.isFinite), v);
    }
    return metricField(m.label, v, m);
  });
  return sparks.length ? { fields, sparks } : { fields };
}

function pushSpark(sparks: WidgetSpark[], m: Metric, values: number[], current: number | string | undefined) {
  if (values.length < 2) return;
  const { unit, max, scale } = sparkScale(m.format);
  sparks.push({ label: m.label, values: values.map((v) => v * scale), current: formatMetric(current, m.format, m.decimals), unit, max });
}

/** Values of the _value column in InfluxDB's annotated CSV, in order. */
export function influxValues(csv: string): number[] {
  const out: number[] = [];
  let col = -1;
  for (const line of csv.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) {
      if (!line) col = -1; // a blank line separates tables, each with its own header
      continue;
    }
    const cells = line.split(",");
    if (col < 0) {
      col = cells.indexOf("_value");
      continue;
    }
    const n = Number(cells[col]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function parseInfluxMetrics(results: number[][], metrics: Metric[]): WidgetResult {
  const sparks: WidgetSpark[] = [];
  const fields = metrics.map((m, i) => {
    const values = results[i] ?? [];
    const last = values.at(-1);
    if (m.chart) pushSpark(sparks, m, values, last);
    return metricField(m.label, last, m);
  });
  return sparks.length ? { fields, sparks } : { fields };
}

/** Any number from anywhere: a JSON API (Beszel, Zabbix, scripts…) or InfluxDB Flux queries. */
export const metric: Integration<typeof schema> = {
  type: "metric",
  schema,
  async fetch(cfg) {
    if (cfg.source === "json") {
      return parseJsonMetrics(await httpJson<unknown>(cfg.url, { headers: cfg.headers, insecure: cfg.insecure }), cfg.metrics);
    }
    const results = await Promise.all(
      cfg.metrics.map(async (m) => {
        if (!m.query) return [];
        const res = await http(`${trimSlash(cfg.url)}/api/v2/query?${new URLSearchParams({ org: cfg.org ?? "" })}`, {
          method: "POST",
          headers: { Authorization: `Token ${cfg.token ?? ""}`, Accept: "application/csv", "Content-Type": "application/vnd.flux", ...cfg.headers },
          body: m.query,
          insecure: cfg.insecure,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from InfluxDB: ${(await res.text()).slice(0, 120)}`);
        return influxValues(await res.text());
      }),
    );
    return parseInfluxMetrics(results, cfg.metrics);
  },
};
