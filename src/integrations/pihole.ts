import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField } from "./types";

const schema = z.object({
  url: z.string().url(),
  /** v6: the web/app password. v5: the API token. */
  key: z.string().optional(),
  version: z.coerce.number().int().min(5).max(6).default(6),
  insecure: z.boolean().optional(),
});

export interface PiholeV6Summary {
  queries: { total: number; blocked: number; percent_blocked: number };
  clients: { active: number; total: number };
}

export interface PiholeV5Summary {
  dns_queries_today: number;
  ads_blocked_today: number;
  ads_percentage_today: number;
  unique_clients: number;
}

const fields = (total: number, blocked: number, percent: number, clients: number): WidgetField[] => [
  { label: "Queries", value: total.toLocaleString("en-US") },
  { label: "Blocked", value: blocked.toLocaleString("en-US") },
  { label: "Blocked %", value: `${percent.toFixed(1)}%` },
  { label: "Clients", value: clients },
];

export const parsePiholeV6 = (s: PiholeV6Summary) =>
  fields(s.queries.total, s.queries.blocked, s.queries.percent_blocked, s.clients.active);

export const parsePiholeV5 = (s: PiholeV5Summary) =>
  fields(s.dns_queries_today, s.ads_blocked_today, Number(s.ads_percentage_today), s.unique_clients);

// v6 sessions are limited, so reuse them until they expire.
const sessions = new Map<string, { sid: string; expires: number }>();

async function v6Session(cfg: z.infer<typeof schema>, fresh = false): Promise<string | undefined> {
  if (!cfg.key) return undefined; // Pi-hole without a password needs no session
  const key = `${cfg.url}|${cfg.key}`;
  const hit = sessions.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.sid;
  const r = await httpJson<{ session: { valid: boolean; sid: string; validity: number } }>(`${trimSlash(cfg.url)}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: cfg.key }),
    insecure: cfg.insecure,
  });
  if (!r.session.valid) throw new Error("Pi-hole rejected the password");
  sessions.set(key, { sid: r.session.sid, expires: Date.now() + (r.session.validity - 30) * 1000 });
  return r.session.sid;
}

export const pihole: Integration<typeof schema> = {
  type: "pihole",
  schema,
  async fetch(cfg) {
    const base = trimSlash(cfg.url);
    if (cfg.version === 5) {
      const q = new URLSearchParams({ summaryRaw: "", ...(cfg.key ? { auth: cfg.key } : {}) });
      return parsePiholeV5(await httpJson<PiholeV5Summary>(`${base}/admin/api.php?${q}`, { insecure: cfg.insecure }));
    }
    const get = async (fresh: boolean) => {
      const sid = await v6Session(cfg, fresh);
      return http(`${base}/api/stats/summary`, { insecure: cfg.insecure, headers: sid ? { "X-FTL-SID": sid } : {} });
    };
    let res = await get(false);
    if (res.status === 401) {
      await res.body?.cancel();
      res = await get(true);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from Pi-hole`);
    return parsePiholeV6((await res.json()) as PiholeV6Summary);
  },
};
