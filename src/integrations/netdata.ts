import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";
import { loadStatus, pct } from "./format";

const schema = z.object({
  url: z.string().url(),
  /** Bearer token for Netdata Cloud-protected agents (optional). */
  token: z.string().optional(),
  insecure: z.boolean().optional(),
  chart: z.boolean().default(true),
});

/** /api/v1/data?format=json: one row per point, [time, dim1, dim2, ...]. */
export interface NetdataSeries {
  labels: string[];
  data: number[][];
}
export interface NetdataAlarm {
  name: string;
  chart: string;
  status: "WARNING" | "CRITICAL" | string;
  value_string?: string;
}

/** Oldest-first rows (the API returns newest first). */
const rows = (s: NetdataSeries) => [...s.data].sort((a, b) => a[0] - b[0]);
const sumRow = (r: number[]) => r.slice(1).reduce((a, v) => a + (v ?? 0), 0);

export function parseNetdata(cpu: NetdataSeries, ram: NetdataSeries | undefined, load: NetdataSeries | undefined, alarms: NetdataAlarm[]): WidgetResult {
  const cpuSeries = rows(cpu).map(sumRow);
  const cpuNow = cpuSeries[cpuSeries.length - 1] ?? 0;
  const result: WidgetResult = { fields: [{ label: "CPU", value: pct(cpuNow / 100), status: loadStatus(cpuNow / 100) }] };

  if (ram?.data.length) {
    const last = rows(ram).at(-1)!;
    const used = last[ram.labels.indexOf("used")] ?? 0;
    const total = sumRow(last);
    if (total) result.fields.push({ label: "RAM", value: pct(used / total), status: loadStatus(used / total) });
  }
  if (load?.data.length) {
    const i = load.labels.indexOf("load5");
    if (i > 0) result.fields.push({ label: "Load", value: rows(load).at(-1)![i].toFixed(2) });
  }
  const critical = alarms.filter((a) => a.status === "CRITICAL");
  const warning = alarms.filter((a) => a.status === "WARNING");
  result.fields.push({ label: "Alarms", value: critical.length + warning.length, status: critical.length ? "error" : warning.length ? "warn" : "ok" });
  if (alarms.length) {
    result.list = [...critical, ...warning].map((a) => ({ label: `${a.name} · ${a.chart}`, value: a.value_string ?? a.status.toLowerCase(), status: a.status === "CRITICAL" ? "error" : "warn" }));
  }
  if (cpuSeries.length > 1) result.sparks = [{ label: "CPU", values: cpuSeries, current: pct(cpuNow / 100), unit: "%", max: 100 }];
  return result;
}

/** Netdata agent: CPU, RAM, load and active alarms. */
export const netdata: Integration<typeof schema> = {
  type: "netdata",
  schema,
  async fetch(cfg) {
    const headers: Record<string, string> = cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {};
    const get = <T,>(path: string) => httpJson<T>(`${trimSlash(cfg.url)}/api/v1/${path}`, { headers, insecure: cfg.insecure });
    const data = (chart: string, points: number) =>
      get<NetdataSeries>(`data?chart=${chart}&after=-${points * 10}&points=${points}&group=average&format=json`);
    const [cpu, ram, load, alarms] = await Promise.all([
      data("system.cpu", cfg.chart ? 30 : 1),
      data("system.ram", 1).catch(() => undefined),
      data("system.load", 1).catch(() => undefined),
      get<{ alarms: Record<string, NetdataAlarm> }>("alarms").then((r) => Object.values(r.alarms ?? {})).catch(() => []),
    ]);
    return parseNetdata(cpu, ram, load, alarms);
  },
};
