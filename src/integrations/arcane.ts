import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration } from "./types";
import { actionDone, containerActions, containerTarget, parseContainers, type ContainerSummary } from "./containers";

const schema = z.object({
  url: z.string().url(),
  /** API key (Settings → API Keys); sent as X-Api-Key. */
  key: z.string().min(1),
  /** Environment id ("0" is the local Docker host). */
  env: z.union([z.string(), z.number()]).transform(String).default("0"),
  insecure: z.boolean().optional(),
});
type Cfg = z.infer<typeof schema>;

export interface ArcaneContainer {
  id: string;
  names: string[];
  image: string;
  state: string;
  status: string;
  updateInfo?: { hasUpdate?: boolean };
}
interface ArcaneList<T> {
  success?: boolean;
  data: T;
}

export function fromArcane(c: ArcaneContainer): ContainerSummary {
  return {
    id: c.id,
    name: (c.names[0] ?? c.id.slice(0, 12)).replace(/^\//, ""),
    state: c.state,
    status: c.status,
    updateAvailable: c.updateInfo?.hasUpdate,
  };
}

const client = (cfg: Cfg) => {
  const base = `${trimSlash(cfg.url)}/api/environments/${encodeURIComponent(cfg.env)}`;
  const headers = { "X-Api-Key": cfg.key };
  return {
    get: <T,>(path: string) => httpJson<ArcaneList<T>>(`${base}/${path}`, { headers, insecure: cfg.insecure }).then((r) => r.data),
    post: (path: string) => http(`${base}/${path}`, { method: "POST", headers, insecure: cfg.insecure, timeoutMs: 60_000 }),
  };
};

const listContainers = (cfg: Cfg) => client(cfg).get<ArcaneContainer[]>("containers?limit=1000").then((cs) => cs.map(fromArcane));

/** Arcane (getarcane.app): containers running/stopped/unhealthy, projects, image updates, and per-container actions. */
export const arcane: Integration<typeof schema> = {
  type: "arcane",
  schema,
  async fetch(cfg) {
    const [containers, projects] = await Promise.all([
      listContainers(cfg),
      client(cfg)
        .get<unknown[]>("projects?limit=1000")
        .then((p) => (Array.isArray(p) ? p.length : undefined))
        .catch(() => undefined),
    ]);
    return parseContainers(containers, { stacks: projects, updates: containers.some((c) => c.updateAvailable !== undefined) });
  },
  actions: {
    async list(cfg) {
      return containerActions(cfg.env, await listContainers(cfg));
    },
    async run(cfg, action, target) {
      const id = containerTarget(cfg.env, action, target);
      const c = (await listContainers(cfg)).find((x) => x.id === id);
      if (!c) throw new Error("Container not found");
      const res = await client(cfg).post(`containers/${encodeURIComponent(c.id)}/${action}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; detail?: string };
        throw new Error(body.detail ?? body.error ?? body.message ?? `HTTP ${res.status} from Arcane`);
      }
      return actionDone(c.name, action);
    },
  },
};
