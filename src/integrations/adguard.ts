import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField } from "./types";

const schema = z.object({
  url: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  insecure: z.boolean().optional(),
});

export interface AdGuardStats {
  num_dns_queries: number;
  num_blocked_filtering: number;
  num_replaced_safebrowsing?: number;
  num_replaced_parental?: number;
  avg_processing_time: number; // seconds
}

export function parseAdGuard(s: AdGuardStats): WidgetField[] {
  const blocked = s.num_blocked_filtering + (s.num_replaced_safebrowsing ?? 0) + (s.num_replaced_parental ?? 0);
  const pct = s.num_dns_queries ? (blocked / s.num_dns_queries) * 100 : 0;
  return [
    { label: "Queries", value: s.num_dns_queries.toLocaleString("en-US") },
    { label: "Blocked", value: blocked.toLocaleString("en-US") },
    { label: "Blocked %", value: `${pct.toFixed(1)}%` },
    { label: "Latency", value: `${(s.avg_processing_time * 1000).toFixed(1)} ms` },
  ];
}

export const adguard: Integration<typeof schema> = {
  type: "adguard",
  schema,
  async fetch(cfg) {
    const auth = cfg.username ? { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ""}`).toString("base64")}` } : undefined;
    return parseAdGuard(await httpJson<AdGuardStats>(`${trimSlash(cfg.url)}/control/stats`, { headers: auth, insecure: cfg.insecure }));
  },
};
