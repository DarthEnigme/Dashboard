import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";

const schema = z.object({
  /** Traefik API, e.g. http://traefik:8080 (api.insecure) or the dashboard's router. */
  url: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  insecure: z.boolean().optional(),
});

interface Counts {
  total?: number;
  warnings?: number;
  errors?: number;
}
export interface TraefikOverview {
  http?: { routers?: Counts; services?: Counts; middlewares?: Counts };
  tcp?: { routers?: Counts; services?: Counts };
  udp?: { routers?: Counts; services?: Counts };
}
export interface TraefikRouter {
  name: string;
  status?: string;
  rule?: string;
  error?: string[];
}

/** Router, service and middleware counts; routers with problems listed. */
export function parseTraefik(o: TraefikOverview, routers: TraefikRouter[]): WidgetResult {
  const sum = (k: "routers" | "services", f: keyof Counts) => (o.http?.[k]?.[f] ?? 0) + (o.tcp?.[k]?.[f] ?? 0) + (o.udp?.[k]?.[f] ?? 0);
  const problems = sum("routers", "errors") + sum("services", "errors") + (o.http?.middlewares?.errors ?? 0);
  const warnings = sum("routers", "warnings") + sum("services", "warnings") + (o.http?.middlewares?.warnings ?? 0);
  return {
    fields: [
      { label: "Routers", value: sum("routers", "total") },
      { label: "Services", value: sum("services", "total") },
      { label: "Middlewares", value: o.http?.middlewares?.total ?? 0 },
      { label: "Issues", value: problems + warnings, status: problems ? "error" : warnings ? "warn" : "ok" },
    ],
    list: routers
      .filter((r) => r.status && r.status !== "enabled")
      .map((r) => ({ label: r.name, value: r.error?.[0]?.slice(0, 60) ?? r.status!, status: r.status === "disabled" ? ("error" as const) : ("warn" as const) })),
  };
}

export const traefik: Integration<typeof schema> = {
  type: "traefik",
  schema,
  async fetch(cfg) {
    const base = trimSlash(cfg.url);
    const headers: Record<string, string> = cfg.username ? { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ""}`).toString("base64")}` } : {};
    const [overview, routers] = await Promise.all([
      httpJson<TraefikOverview>(`${base}/api/overview`, { insecure: cfg.insecure, headers }),
      httpJson<TraefikRouter[]>(`${base}/api/http/routers?per_page=200`, { insecure: cfg.insecure, headers }).catch(() => []),
    ]);
    return parseTraefik(overview, routers);
  },
};
