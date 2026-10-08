import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration, ServiceAction, WidgetField, WidgetResult } from "./types";
import { bytes, duration } from "./format";

const schema = z.object({
  url: z.string().url(),
  /** Client API key (Account → API Credentials, starts with ptlc_ or pacc_). */
  key: z.string().min(1),
  insecure: z.boolean().optional(),
});
type Cfg = z.infer<typeof schema>;

export interface PelicanServer {
  attributes: { identifier: string; name: string; node?: string; is_suspended?: boolean; status?: string | null };
}
export interface PelicanResources {
  attributes: {
    current_state: string;
    is_suspended?: boolean;
    resources: { memory_bytes?: number; cpu_absolute?: number; disk_bytes?: number; uptime?: number };
  };
}

const client = (cfg: Cfg) => {
  const headers = { Authorization: `Bearer ${cfg.key}`, Accept: "application/json" };
  const url = (path: string) => `${trimSlash(cfg.url)}/api/client${path}`;
  return {
    get: <T,>(path: string) => httpJson<T>(url(path), { headers, insecure: cfg.insecure }),
    post: (path: string, body: unknown) =>
      http(url(path), { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body), insecure: cfg.insecure }),
  };
};

/** Server ids are short hex ids (8 chars) or UUIDs. */
const ID = /^[0-9a-f]{8}(-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;
export const POWER = ["start", "stop", "restart", "kill"] as const;

// Problems first: down, suspended, changing state, then running.
const ORDER: Record<string, number> = { unknown: 0, offline: 0, suspended: 1, stopping: 2, starting: 3, installing: 4, running: 5 };

export function parsePelican(servers: PelicanServer[], states: Map<string, PelicanResources["attributes"] | undefined>): WidgetResult {
  const rows = servers.map((s) => {
    const a = s.attributes;
    const r = states.get(a.identifier);
    const state = a.is_suspended || r?.is_suspended ? "suspended" : a.status === "installing" ? "installing" : (r?.current_state ?? "unknown");
    return { a, r: r?.resources, state };
  });
  const count = (st: string) => rows.filter((x) => x.state === st).length;
  const running = count("running");
  const offline = rows.filter((x) => ["offline", "suspended", "unknown"].includes(x.state)).length;
  const list: WidgetField[] = rows
    .sort((x, y) => (ORDER[x.state] ?? -1) - (ORDER[y.state] ?? -1) || x.a.name.localeCompare(y.a.name))
    .map(({ a, r, state }) => ({
      label: a.name,
      value:
        state === "running" && r
          ? `${Math.round(r.cpu_absolute ?? 0)}% · ${bytes(r.memory_bytes ?? 0)}${r.uptime ? ` · up ${duration(Math.round(r.uptime / 1000))}` : ""}`
          : state,
      status: state === "running" ? "ok" : state === "starting" || state === "stopping" || state === "installing" ? "warn" : "error",
      raw: r?.cpu_absolute,
    }));
  const cpu = rows.reduce((t, x) => t + (x.r?.cpu_absolute ?? 0), 0);
  const mem = rows.reduce((t, x) => t + (x.r?.memory_bytes ?? 0), 0);
  return {
    fields: [
      { label: "Running", value: running, status: "ok" },
      { label: "Offline", value: offline, status: offline ? "warn" : "ok" },
      { label: "CPU", value: `${Math.round(cpu)}%`, raw: cpu },
      { label: "Memory", value: bytes(mem), raw: mem },
    ],
    list,
  };
}

async function load(cfg: Cfg) {
  const api = client(cfg);
  const { data } = await api.get<{ data: PelicanServer[] }>("?per_page=100");
  const states = new Map(
    await Promise.all(
      data.map(async (s) => [s.attributes.identifier, await api.get<PelicanResources>(`/servers/${s.attributes.identifier}/resources`).then((r) => r.attributes).catch(() => undefined)] as const),
    ),
  );
  return { api, data, states };
}

/** Pelican Panel (and Pterodactyl): game servers running/offline, CPU and memory, and power buttons. */
export const pelican: Integration<typeof schema> = {
  type: "pelican",
  schema,
  async fetch(cfg) {
    const { data, states } = await load(cfg);
    return parsePelican(data, states);
  },
  actions: {
    async list(cfg) {
      const { data, states } = await load(cfg);
      const out: ServiceAction[] = [];
      for (const s of data) {
        const a = s.attributes;
        const state = states.get(a.identifier)?.current_state;
        if (a.is_suspended) continue;
        const base = { target: a.identifier, targetLabel: a.name };
        if (state === "offline" || !state) out.push({ id: "start", label: "Start", ...base });
        if (state === "running" || state === "starting") {
          out.push({ id: "restart", label: "Restart", ...base });
          out.push({ id: "stop", label: "Stop", danger: true, ...base });
        }
        if (state === "stopping") out.push({ id: "kill", label: "Kill", danger: true, ...base });
      }
      return out;
    },
    async run(cfg, action, target) {
      if (!(POWER as readonly string[]).includes(action)) throw new Error("Unknown action");
      if (!target || !ID.test(target)) throw new Error("Unknown server");
      const res = await client(cfg).post(`/servers/${target}/power`, { signal: action });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { errors?: { detail?: string }[] };
        throw new Error(body.errors?.[0]?.detail ?? `HTTP ${res.status} from Pelican`);
      }
      await res.body?.cancel();
      return `${target}: ${action === "kill" ? "killed" : action === "stop" ? "stopping" : action === "start" ? "starting" : "restarting"}`;
    },
  },
};
