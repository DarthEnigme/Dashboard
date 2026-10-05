import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";
import { bytes, loadStatus, pct } from "./format";

const schema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  insecure: z.boolean().optional(),
});
type Cfg = z.infer<typeof schema>;

interface SynoResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: number };
}

export interface SynoUtilization {
  cpu: { user_load: number; system_load: number; other_load: number };
  memory: { real_usage: number };
}
export interface SynoVolume {
  vol_path: string;
  status: string;
  size: { total: string; used: string };
}

export function parseSynology(util: SynoUtilization, volumes: SynoVolume[]): WidgetResult {
  const cpu = (util.cpu.user_load + util.cpu.system_load + util.cpu.other_load) / 100;
  const mem = util.memory.real_usage / 100;
  const total = volumes.reduce((a, v) => a + Number(v.size.total), 0);
  const used = volumes.reduce((a, v) => a + Number(v.size.used), 0);
  const bad = volumes.filter((v) => v.status !== "normal");
  return {
    fields: [
      { label: "CPU", value: pct(cpu), status: loadStatus(cpu) },
      { label: "RAM", value: pct(mem), status: loadStatus(mem) },
      ...(total ? [{ label: "Storage", value: pct(used / total), status: loadStatus(used / total) }] : []),
      { label: "Volumes", value: bad.length ? `${bad.length} degraded` : "OK", status: bad.length ? ("error" as const) : ("ok" as const) },
    ],
    list: volumes.map((v) => ({
      label: v.vol_path,
      value: `${bytes(Number(v.size.used))} / ${bytes(Number(v.size.total))} · ${v.status}`,
      status: v.status === "normal" ? undefined : "error",
    })),
  };
}

const sessions = new Map<string, string>();
/** Session expired / not logged in (DSM error codes 106, 107, 119). */
const SESSION_ERRORS = new Set([106, 107, 119]);

async function login(cfg: Cfg): Promise<string> {
  const q = new URLSearchParams({ api: "SYNO.API.Auth", version: "6", method: "login", account: cfg.username, passwd: cfg.password, session: "Page", format: "sid" });
  const r = await httpJson<SynoResponse<{ sid: string }>>(`${trimSlash(cfg.url)}/webapi/auth.cgi?${q}`, { insecure: cfg.insecure });
  if (!r.success || !r.data) {
    const code = r.error?.code;
    throw new Error(code === 403 || code === 406 ? "DSM requires 2-step verification for this account" : `DSM login failed (code ${code})`);
  }
  return r.data.sid;
}

async function call<T>(cfg: Cfg, api: string, method: string, version = 1): Promise<T> {
  const key = `${cfg.url}|${cfg.username}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let sid = sessions.get(key);
    if (!sid) {
      sid = await login(cfg);
      sessions.set(key, sid);
    }
    const q = new URLSearchParams({ api, version: String(version), method, _sid: sid });
    const r = await httpJson<SynoResponse<T>>(`${trimSlash(cfg.url)}/webapi/entry.cgi?${q}`, { insecure: cfg.insecure });
    if (r.success && r.data) return r.data;
    if (SESSION_ERRORS.has(r.error?.code ?? 0)) {
      sessions.delete(key);
      continue;
    }
    throw new Error(`DSM ${api} failed (code ${r.error?.code})`);
  }
  throw new Error("DSM session could not be established");
}

export const synology: Integration<typeof schema> = {
  type: "synology",
  schema,
  async fetch(cfg) {
    const [util, storage] = await Promise.all([
      call<SynoUtilization>(cfg, "SYNO.Core.System.Utilization", "get"),
      call<{ volumes: SynoVolume[] }>(cfg, "SYNO.Storage.CGI.Storage", "load_info"),
    ]);
    return parseSynology(util, storage.volumes ?? []);
  },
};
