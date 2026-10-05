import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";

const schema = z.object({
  url: z.string().url(),
  /** Service account token (Administration → Service accounts), Viewer role is enough. */
  token: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  insecure: z.boolean().optional(),
  /**
   * Panels to embed on the service page. Grafana must allow embedding (allow_embedding = true)
   * and the viewer's browser must be signed in to Grafana or anonymous access must be on.
   */
  panels: z
    .array(
      z.object({
        dashboard: z.string().min(1), // dashboard UID
        panel: z.number().int(),
        title: z.string().optional(),
        from: z.string().default("now-6h"),
        theme: z.enum(["dark", "light"]).optional(),
      }),
    )
    .default([]),
});

export interface GrafanaAlert {
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  state: string;
  activeAt?: string;
}

const isFiring = (s: string) => /^(alerting|firing)/i.test(s);
const isPending = (s: string) => /^pending/i.test(s);

export function parseGrafana(health: { database?: string; version?: string }, alerts: GrafanaAlert[] | undefined, dashboards: number | undefined): WidgetResult {
  const firing = alerts?.filter((a) => isFiring(a.state)) ?? [];
  const pending = alerts?.filter((a) => isPending(a.state)) ?? [];
  const result: WidgetResult = {
    fields: [
      { label: "Firing", value: alerts ? firing.length : "–", status: firing.length ? "error" : "ok" },
      { label: "Pending", value: alerts ? pending.length : "–", status: pending.length ? "warn" : "ok" },
    ],
  };
  if (dashboards !== undefined) result.fields.push({ label: "Dashboards", value: dashboards });
  result.fields.push({ label: "Health", value: health.database === "ok" ? health.version ?? "ok" : health.database ?? "?", status: health.database === "ok" ? "ok" : "error" });
  if (firing.length || pending.length) {
    result.list = [...firing, ...pending].map((a) => ({
      label: a.labels.alertname ?? a.annotations?.summary ?? "alert",
      value: isFiring(a.state) ? "firing" : "pending",
      status: isFiring(a.state) ? "error" : "warn",
    }));
  }
  return result;
}

export function panelUrl(base: string, p: z.infer<typeof schema>["panels"][number]) {
  const q = new URLSearchParams({ panelId: String(p.panel), from: p.from, to: "now" });
  if (p.theme) q.set("theme", p.theme);
  return `${trimSlash(base)}/d-solo/${encodeURIComponent(p.dashboard)}/_?${q}`;
}

/** Grafana: alert counts (unified alerting), firing alerts, health; embedded panels on the service page. */
export const grafana: Integration<typeof schema> = {
  type: "grafana",
  schema,
  async fetch(cfg) {
    const headers: Record<string, string> = {};
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    else if (cfg.username) headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ""}`).toString("base64")}`;
    const get = <T,>(path: string) => httpJson<T>(`${trimSlash(cfg.url)}${path}`, { headers, insecure: cfg.insecure });
    const authed = !!headers.Authorization;
    const [health, alerts, dashboards] = await Promise.all([
      get<{ database?: string; version?: string }>("/api/health"),
      // Alerts and search need a token; without one only health is shown.
      authed ? get<{ data: { alerts: GrafanaAlert[] } }>("/api/prometheus/grafana/api/v1/alerts").then((r) => r.data.alerts) : undefined,
      authed ? get<unknown[]>("/api/search?type=dash-db&limit=5000").then((r) => r.length).catch(() => undefined) : undefined,
    ]);
    const result = parseGrafana(health, alerts, dashboards);
    if (cfg.panels.length) result.embeds = cfg.panels.map((p) => ({ title: p.title ?? `Panel ${p.panel}`, url: panelUrl(cfg.url, p) }));
    return result;
  },
};
