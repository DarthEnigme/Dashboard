import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";
import { bytes, duration, pct } from "./format";

const schema = z.object({
  url: z.string().url(),
  /** API key (user menu → API Keys). */
  key: z.string().min(1),
  insecure: z.boolean().optional(),
});

export interface TruenasPool {
  name: string;
  status: string;
  healthy: boolean;
  size?: number;
  allocated?: number;
}
export interface TruenasAlert {
  level: string;
  dismissed: boolean;
}

export function parseTruenas(pools: TruenasPool[], alerts: TruenasAlert[], uptimeSeconds?: number): WidgetResult {
  const healthy = pools.filter((p) => p.healthy).length;
  const active = alerts.filter((a) => !a.dismissed);
  const critical = active.some((a) => /CRITICAL|ERROR|ALERT|EMERGENCY/.test(a.level));
  const fields: WidgetField[] = [
    { label: "Pools", value: `${healthy} / ${pools.length}`, status: healthy < pools.length ? "error" : "ok" },
    { label: "Alerts", value: active.length, status: critical ? "error" : active.length ? "warn" : "ok" },
  ];
  const used = pools.reduce((a, p) => a + (p.allocated ?? 0), 0);
  const total = pools.reduce((a, p) => a + (p.size ?? 0), 0);
  if (total) fields.push({ label: "Used", value: pct(used / total), status: used / total > 0.9 ? "error" : used / total > 0.8 ? "warn" : "ok" });
  if (uptimeSeconds) fields.push({ label: "Uptime", value: duration(uptimeSeconds) });
  return {
    fields,
    list: pools.map((p) => ({
      label: p.name,
      value: p.size ? `${bytes(p.allocated ?? 0)} / ${bytes(p.size)} · ${p.status}` : p.status,
      status: p.healthy ? undefined : "error",
    })),
  };
}

/** TrueNAS SCALE REST API v2.0 (deprecated upstream in 25.x in favour of JSON-RPC, still served). */
export const truenas: Integration<typeof schema> = {
  type: "truenas",
  schema,
  async fetch(cfg) {
    const get = <T,>(path: string) =>
      httpJson<T>(`${trimSlash(cfg.url)}/api/v2.0/${path}`, { insecure: cfg.insecure, headers: { Authorization: `Bearer ${cfg.key}` } });
    const [pools, alerts, info] = await Promise.all([
      get<TruenasPool[]>("pool"),
      get<TruenasAlert[]>("alert/list"),
      get<{ uptime_seconds?: number }>("system/info").catch(() => ({ uptime_seconds: undefined })),
    ]);
    return parseTruenas(pools, alerts, info.uptime_seconds);
  },
};
