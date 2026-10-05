import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration } from "./types";
import { actionDone, containerActions, containerTarget, parseContainers, type ContainerSummary } from "./containers";

const schema = z.object({
  url: z.string().url(),
  /** API token (Profile → API tokens, starts with dh_). Not needed when Dockhand runs without auth. */
  token: z.string().optional(),
  /** Environment id (1 = the first environment; see Settings → Environments). */
  env: z.number().int().min(1).default(1),
  insecure: z.boolean().optional(),
});
type Cfg = z.infer<typeof schema>;

export type DockhandContainer = Pick<ContainerSummary, "id" | "name" | "state" | "status"> & { image?: string };

const client = (cfg: Cfg) => {
  const headers: Record<string, string> = cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {};
  const url = (path: string) => `${trimSlash(cfg.url)}/api/${path}${path.includes("?") ? "&" : "?"}env=${cfg.env}`;
  return {
    get: <T,>(path: string) => httpJson<T>(url(path), { headers, insecure: cfg.insecure }),
    post: (path: string) => http(url(path), { method: "POST", headers, insecure: cfg.insecure, timeoutMs: 60_000 }),
  };
};

/** Dockhand (dockhand.pro): containers running/stopped/unhealthy, stacks, and per-container start/stop/restart. */
export const dockhand: Integration<typeof schema> = {
  type: "dockhand",
  schema,
  async fetch(cfg) {
    const api = client(cfg);
    const [containers, stacks] = await Promise.all([
      api.get<DockhandContainer[]>("containers"),
      api.get<unknown[]>("stacks").then((s) => (Array.isArray(s) ? s.length : undefined)).catch(() => undefined),
    ]);
    return parseContainers(containers, { stacks });
  },
  actions: {
    async list(cfg) {
      return containerActions(cfg.env, await client(cfg).get<DockhandContainer[]>("containers"));
    },
    async run(cfg, action, target) {
      const id = containerTarget(cfg.env, action, target);
      const api = client(cfg);
      const c = (await api.get<DockhandContainer[]>("containers")).find((x) => x.id === id || x.id.startsWith(id));
      if (!c) throw new Error("Container not found");
      const res = await api.post(`containers/${encodeURIComponent(c.id)}/${action}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
        throw new Error(body.details ?? body.error ?? `HTTP ${res.status} from Dockhand`);
      }
      return actionDone(c.name, action);
    },
  },
};
