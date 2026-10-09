import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";
import { bytes, duration } from "./format";

const schema = z.object({
  /** WGDashboard's address, with its path prefix if it has one (APP_PREFIX). */
  url: z.string().url(),
  /** API key (Settings → API Keys); sent as the wg-dashboard-apikey header. */
  key: z.string().min(1),
  /** Only this WireGuard configuration (interface), e.g. wg0; default: all of them. */
  config: z.string().optional(),
  insecure: z.boolean().optional(),
});
type Cfg = z.infer<typeof schema>;

/** A WireGuard configuration as /api/getWireguardConfigurations lists it (data in GB). */
export interface WgdConfiguration {
  Name: string;
  Status: boolean;
  ConnectedPeers?: number;
  TotalPeers?: number;
  DataUsage?: { Total?: number; Sent?: number; Receive?: number };
}

/**
 * A peer from /api/getWireguardConfigurationInfo. WGDashboard also returns the peer's keys; only
 * the fields below are ever read, so those never reach the browser.
 */
export interface WgdPeer {
  name?: string;
  id?: string;
  /** "running" when it handshook within the last few minutes. */
  status?: string;
  /** Time since the last handshake as Python prints a timedelta ("0:01:23", "2 days, 3:04:05"), or "No Handshake". */
  latest_handshake?: string;
  total_receive?: number;
  total_sent?: number;
  cumu_receive?: number;
  cumu_sent?: number;
}

interface Envelope<T> {
  status: boolean;
  message?: string | null;
  data: T;
}

const GB = 1024 ** 3;

/** "2 days, 3:04:05" → seconds; undefined for "No Handshake" or anything unreadable. */
export function handshakeSeconds(s: string | undefined): number | undefined {
  const m = /^(?:(\d+) days?, )?(\d+):(\d\d):(\d\d)/.exec(s?.trim() ?? "");
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

export function parseWgDashboard(configs: WgdConfiguration[], peers: Record<string, WgdPeer[]>): WidgetResult {
  const up = configs.filter((c) => c.Status).length;
  const connected = configs.reduce((a, c) => a + (c.ConnectedPeers ?? 0), 0);
  const total = configs.reduce((a, c) => a + (c.TotalPeers ?? 0), 0);
  // The server's view: what it received from peers is their upload.
  const received = configs.reduce((a, c) => a + (c.DataUsage?.Receive ?? 0), 0) * GB;
  const sent = configs.reduce((a, c) => a + (c.DataUsage?.Sent ?? 0), 0) * GB;

  const several = configs.length > 1;
  const rows = configs.flatMap((c) =>
    (peers[c.Name] ?? []).map((p) => {
      const online = c.Status && p.status === "running";
      const ago = handshakeSeconds(p.latest_handshake);
      const traffic = ((p.total_receive ?? 0) + (p.total_sent ?? 0) + (p.cumu_receive ?? 0) + (p.cumu_sent ?? 0)) * GB;
      const name = p.name?.trim() || p.id?.slice(0, 8) || "Unnamed peer";
      return {
        online,
        ago: ago ?? Infinity,
        name,
        row: {
          label: several ? `${name} (${c.Name})` : name,
          value: online ? `online · ${bytes(traffic)}` : ago === undefined ? "never connected" : `last seen ${duration(Math.max(60, ago))} ago`,
          status: online ? ("ok" as const) : ("warn" as const),
        },
      };
    }),
  );
  rows.sort((a, b) => Number(b.online) - Number(a.online) || a.ago - b.ago || a.name.localeCompare(b.name));

  return {
    fields: [
      { label: "Connected", value: connected, raw: connected, status: "ok" },
      { label: "Peers", value: `${connected} / ${total}`, raw: total },
      ...(several || up < configs.length
        ? [{ label: "Interfaces", value: `${up} / ${configs.length}`, raw: up, status: up < configs.length ? ("warn" as const) : ("ok" as const) }]
        : []),
      { label: "Received", value: bytes(received), raw: received },
      { label: "Sent", value: bytes(sent), raw: sent },
    ],
    list: rows.map((r) => r.row),
  };
}

async function api<T>(cfg: Cfg, path: string): Promise<T> {
  const r = await httpJson<Envelope<T>>(`${trimSlash(cfg.url)}/api/${path}`, { headers: { "wg-dashboard-apikey": cfg.key }, insecure: cfg.insecure });
  // A wrong key or a disabled API can answer 200 with status false.
  if (!r || r.status === false) throw new Error(r?.message || "WGDashboard refused the request: check the API key");
  return r.data;
}

/** WireGuard through WGDashboard: interfaces, connected peers, traffic, and when each peer was last seen. */
export const wgdashboard: Integration<typeof schema> = {
  type: "wgdashboard",
  schema,
  async fetch(cfg) {
    let configs = await api<WgdConfiguration[]>(cfg, "getWireguardConfigurations");
    if (cfg.config) {
      configs = configs.filter((c) => c.Name === cfg.config);
      if (!configs.length) throw new Error(`No WireGuard configuration called ${cfg.config}`);
    }
    const lists = await Promise.all(
      configs.map((c) =>
        api<{ configurationPeers?: WgdPeer[] }>(cfg, `getWireguardConfigurationInfo?configurationName=${encodeURIComponent(c.Name)}`)
          .then((d) => d.configurationPeers ?? [])
          // Peers are the detail list: an interface whose peers fail to load still counts in the totals.
          .catch(() => [] as WgdPeer[]),
      ),
    );
    return parseWgDashboard(configs, Object.fromEntries(configs.map((c, i) => [c.Name, lists[i]])));
  },
};
