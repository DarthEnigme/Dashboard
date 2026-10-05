import { z } from "zod";
import { http, trimSlash } from "@/lib/http";
import type { Integration, WidgetField } from "./types";

const schema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  site: z.string().default("default"),
  insecure: z.boolean().default(true),
});
type Cfg = z.infer<typeof schema>;

export interface UnifiHealth {
  subsystem: string;
  status?: string;
  num_user?: number;
  num_adopted?: number;
  num_disconnected?: number;
  latency?: number;
  wan_ip?: string;
}

export function parseUnifi(health: UnifiHealth[]): WidgetField[] {
  const by = (s: string) => health.find((h) => h.subsystem === s);
  const clients = (by("wlan")?.num_user ?? 0) + (by("lan")?.num_user ?? 0);
  const adopted = health.reduce((a, h) => a + (h.num_adopted ?? 0), 0);
  const offline = health.reduce((a, h) => a + (h.num_disconnected ?? 0), 0);
  const wan = by("wan")?.status;
  const latency = by("www")?.latency;
  return [
    { label: "Clients", value: clients },
    { label: "Devices", value: `${adopted - offline} / ${adopted}`, status: offline ? "warn" : "ok" },
    { label: "WAN", value: wan === "ok" ? "Up" : wan ?? "–", status: wan === "ok" ? "ok" : "error" },
    ...(latency !== undefined ? [{ label: "Latency", value: `${latency} ms` }] : []),
  ];
}

interface Session {
  cookie: string;
  csrf?: string;
  /** UniFi OS consoles (UDM, Cloud Key Gen2+) proxy the Network app under /proxy/network. */
  prefix: string;
}

const sessions = new Map<string, Session>();

async function login(cfg: Cfg): Promise<Session> {
  const base = trimSlash(cfg.url);
  const body = JSON.stringify({ username: cfg.username, password: cfg.password, remember: true });
  const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body, insecure: cfg.insecure };

  let res = await http(`${base}/api/auth/login`, opts);
  let prefix = "/proxy/network";
  if (res.status === 404 || res.status === 405) {
    await res.body?.cancel();
    res = await http(`${base}/api/login`, opts); // classic controller
    prefix = "";
  }
  await res.body?.cancel();
  if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? "UniFi rejected the login" : `HTTP ${res.status} from UniFi login`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, csrf: res.headers.get("x-csrf-token") ?? undefined, prefix };
}

export const unifi: Integration<typeof schema> = {
  type: "unifi",
  schema,
  async fetch(cfg) {
    const key = `${cfg.url}|${cfg.username}|${cfg.password}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      let s = sessions.get(key);
      if (!s) {
        s = await login(cfg);
        sessions.set(key, s);
      }
      const res = await http(`${trimSlash(cfg.url)}${s.prefix}/api/s/${encodeURIComponent(cfg.site)}/stat/health`, {
        insecure: cfg.insecure,
        headers: { Cookie: s.cookie, ...(s.csrf ? { "X-CSRF-Token": s.csrf } : {}) },
      });
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel();
        sessions.delete(key); // session expired: log in again
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from UniFi`);
      return parseUnifi(((await res.json()) as { data: UnifiHealth[] }).data);
    }
    throw new Error("UniFi login failed");
  },
};
