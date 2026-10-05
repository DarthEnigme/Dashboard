import { dockerClient } from "./docker";
import { substituteEnv } from "./config/env";
import { tileSizes, type Service, type ServiceGroup } from "./config/schema";

export interface DiscoveredService {
  group: string;
  tab?: string;
  service: Service;
}

export interface ContainerInfo {
  Names: string[];
  Labels: Record<string, string>;
}

const PREFIX = "page.";

/**
 * Turn container labels into services:
 *   page.group, page.name, page.href, page.icon, page.description, page.ping, page.size, page.tab, page.alert
 *   page.widget.<key>   widget settings (defaults to a docker widget for the container itself)
 */
export function servicesFromContainers(containers: ContainerInfo[], host?: string): DiscoveredService[] {
  const out: DiscoveredService[] = [];
  for (const c of containers) {
    const labels = Object.fromEntries(
      Object.entries(c.Labels ?? {})
        .filter(([k]) => k.startsWith(PREFIX))
        .map(([k, v]) => [k.slice(PREFIX.length), substituteEnv(v)]),
    );
    if (!Object.keys(labels).length) continue;

    const container = (c.Names?.[0] ?? "").replace(/^\//, "");
    const widget: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(labels)) {
      if (!k.startsWith("widget.")) continue;
      const key = k.slice("widget.".length);
      widget[key] = v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v;
    }

    const size = tileSizes.find((s) => s === labels.size);
    const ping = labels.ping === undefined || labels.ping === "false" ? undefined : labels.ping === "true" ? true : labels.ping;
    const service: Service = {
      name: labels.name || container,
      href: labels.href,
      icon: labels.icon,
      description: labels.description,
      ping,
      size,
      alert: labels.alert === "false" ? false : undefined,
      widget: widget.type
        ? (widget as Service["widget"])
        : { type: "docker", container, ...(host ? { host } : {}) },
      source: "docker",
    };
    out.push({ group: labels.group || "Docker", tab: labels.tab, service });
  }
  return out;
}

/** Append discovered services to groups with the same name, or to new groups after the YAML ones. */
export function mergeDiscovered(groups: ServiceGroup[], found: DiscoveredService[]): ServiceGroup[] {
  const merged = groups.map((g) => ({ ...g, services: [...g.services] }));
  for (const d of found) {
    let g = merged.find((x) => x.name === d.group);
    if (!g) {
      g = { name: d.group, tab: d.tab, services: [] };
      merged.push(g);
    }
    g.services.push(d.service);
  }
  return merged;
}

const TTL = 30_000;
let cache: { at: number; key: string; result: Promise<{ services: DiscoveredService[]; errors: string[] }> } | undefined;

export function discover(hosts: { name: string; host?: string }[]) {
  const key = JSON.stringify(hosts);
  if (cache && cache.key === key && Date.now() - cache.at < TTL) return cache.result;
  const result = Promise.all(
    hosts.map(async (h) => {
      try {
        const containers = await dockerClient(h.host).listContainers();
        return { services: servicesFromContainers(containers, h.host), error: undefined };
      } catch (e) {
        return { services: [], error: `Docker discovery (${h.name}): ${(e as Error).message}` };
      }
    }),
  ).then((rs) => ({
    services: rs.flatMap((r) => r.services),
    errors: rs.map((r) => r.error).filter((e): e is string => !!e),
  }));
  cache = { at: Date.now(), key, result };
  return result;
}
