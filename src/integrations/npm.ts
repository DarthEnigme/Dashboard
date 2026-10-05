import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";

const schema = z.object({
  url: z.string().url(),
  /** Login email and password of a Nginx Proxy Manager user. */
  username: z.string().min(1),
  password: z.string().min(1),
  /** Certificates expiring within this many days are flagged. */
  certDays: z.number().min(1).default(14),
  insecure: z.boolean().optional(),
});
type Cfg = z.infer<typeof schema>;

export interface NpmHost {
  enabled: boolean | number;
  domain_names: string[];
}
export interface NpmCert {
  id: number;
  nice_name?: string;
  domain_names: string[];
  /** "2026-12-01 10:00:00" (UTC). */
  expires_on: string;
}

const DAY = 86_400_000;

/** Proxy hosts, redirections and certificates, soonest-expiring first. */
export function parseNpm(proxy: NpmHost[], redirects: NpmHost[], certs: NpmCert[], now: number, certDays: number): WidgetResult {
  const enabled = proxy.filter((h) => !!h.enabled).length;
  const days = (c: NpmCert) => Math.floor((Date.parse(`${c.expires_on.replace(" ", "T")}Z`) - now) / DAY);
  const sorted = [...certs].sort((a, b) => days(a) - days(b));
  const expiring = sorted.filter((c) => days(c) <= certDays);
  return {
    fields: [
      { label: "Proxy hosts", value: `${enabled} / ${proxy.length}` },
      { label: "Redirects", value: redirects.length },
      { label: "Certificates", value: certs.length },
      { label: "Expiring", value: expiring.length, status: expiring.some((c) => days(c) < 0) ? "error" : expiring.length ? "warn" : "ok" },
    ],
    list: sorted.map((c) => {
      const d = days(c);
      return {
        label: c.nice_name || c.domain_names[0] || `#${c.id}`,
        value: d < 0 ? "expired" : d <= 90 ? `${d} d` : c.expires_on.slice(0, 10),
        status: d < 0 ? ("error" as const) : d <= certDays ? ("warn" as const) : undefined,
      };
    }),
  };
}

const tokens = new Map<string, { token: string; expires: number }>();

async function token(cfg: Cfg, fresh = false): Promise<string> {
  const key = `${cfg.url}|${cfg.username}`;
  const hit = tokens.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.token;
  const r = await httpJson<{ token: string; expires?: string }>(`${trimSlash(cfg.url)}/api/tokens`, {
    method: "POST",
    insecure: cfg.insecure,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: cfg.username, secret: cfg.password }),
  });
  tokens.set(key, { token: r.token, expires: Math.min(Date.parse(r.expires ?? "") || Infinity, Date.now() + 12 * 3_600_000) });
  return r.token;
}

export const npm: Integration<typeof schema> = {
  type: "npm",
  schema,
  async fetch(cfg) {
    const base = trimSlash(cfg.url);
    const get = async <T>(path: string, fresh = false): Promise<T> =>
      httpJson<T>(`${base}${path}`, { insecure: cfg.insecure, headers: { Authorization: `Bearer ${await token(cfg, fresh)}` } });
    let proxy: NpmHost[];
    try {
      proxy = await get<NpmHost[]>("/api/nginx/proxy-hosts");
    } catch {
      proxy = await get<NpmHost[]>("/api/nginx/proxy-hosts", true); // token expired
    }
    const [redirects, certs] = await Promise.all([get<NpmHost[]>("/api/nginx/redirection-hosts").catch(() => []), get<NpmCert[]>("/api/nginx/certificates")]);
    return parseNpm(proxy, redirects, certs, Date.now(), cfg.certDays);
  },
};
