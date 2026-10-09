import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";
import { bytes, pct } from "./format";

const schema = z
  .object({
    /** API token: Account → Cloudflare Tunnel → Read for tunnels; Zone → Analytics → Read for a zone. */
    key: z.string().min(1),
    /** Account ID, for tunnels. */
    account: z.string().optional(),
    /** Only this tunnel (name); default: all of the account's tunnels. */
    tunnel: z.string().optional(),
    /** Set false to show only the zone's traffic. */
    tunnels: z.boolean().default(true),
    /** Zone ID (a website): requests, cache, threats, bandwidth and visitors over the last 24 hours. */
    zone: z.string().optional(),
    url: z.string().url().default("https://api.cloudflare.com/client/v4"),
  })
  .refine((c) => (c.tunnels && c.account) || c.zone, { message: "Give an account (tunnels) or a zone (website traffic)" });
type Cfg = z.infer<typeof schema>;

export interface CfTunnel {
  name: string;
  status: string;
  connections?: { colo_name?: string; is_pending_reconnect?: boolean }[];
}

/** Tunnel health; healthy / degraded / down per tunnel. */
export function parseCloudflare(tunnels: CfTunnel[]): WidgetResult {
  const healthy = tunnels.filter((t) => t.status === "healthy").length;
  const down = tunnels.filter((t) => t.status === "down").length;
  const connections = tunnels.reduce((a, t) => a + (t.connections?.length ?? 0), 0);
  const colos = [...new Set(tunnels.flatMap((t) => t.connections?.map((c) => c.colo_name).filter(Boolean) ?? []))];
  return {
    fields: [
      { label: "Healthy", value: `${healthy} / ${tunnels.length}`, status: down ? "error" : healthy < tunnels.length ? "warn" : "ok" },
      { label: "Connections", value: connections },
      ...(colos.length ? [{ label: "Edges", value: colos.slice(0, 3).join(", ") }] : []),
    ],
    list: tunnels.map((t) => ({
      label: t.name,
      value: `${t.status} · ${t.connections?.length ?? 0} conn`,
      status: t.status === "healthy" ? undefined : t.status === "down" ? ("error" as const) : ("warn" as const),
    })),
  };
}

/** One hour of a zone's HTTP traffic (GraphQL httpRequests1hGroups). */
export interface CfHour {
  sum: { requests: number; cachedRequests: number; bytes: number; threats: number };
  uniq?: { uniques: number };
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n.toLocaleString("en-US"));

/** The last 24 hours of a zone, and its status when it isn't active. */
export function parseZone(hours: CfHour[], zone?: { name?: string; status?: string }): WidgetField[] {
  const t = hours.reduce(
    (a, h) => ({
      requests: a.requests + h.sum.requests,
      cached: a.cached + h.sum.cachedRequests,
      bytes: a.bytes + h.sum.bytes,
      threats: a.threats + h.sum.threats,
      uniques: a.uniques + (h.uniq?.uniques ?? 0),
    }),
    { requests: 0, cached: 0, bytes: 0, threats: 0, uniques: 0 },
  );
  return [
    ...(zone?.status && zone.status !== "active" ? [{ label: "Zone", value: zone.status, status: "warn" as const }] : []),
    { label: "Requests", value: compact(t.requests), raw: t.requests },
    { label: "Cached", value: t.requests ? pct(t.cached / t.requests) : "–", raw: t.requests ? (t.cached / t.requests) * 100 : 0 },
    { label: "Threats", value: compact(t.threats), raw: t.threats, status: t.threats ? "warn" : undefined },
    { label: "Bandwidth", value: bytes(t.bytes), raw: t.bytes },
    { label: "Visitors", value: compact(t.uniques), raw: t.uniques },
  ];
}

const ZONE_QUERY = `query ($zone: String!, $since: Time!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      httpRequests1hGroups(limit: 25, filter: { datetime_geq: $since }) {
        sum { requests cachedRequests bytes threats }
        uniq { uniques }
      }
    }
  }
}`;

async function zoneTraffic(cfg: Cfg, zone: string, now = Date.now()): Promise<WidgetField[]> {
  const headers = { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" };
  const [info, gql] = await Promise.all([
    httpJson<{ success: boolean; result?: { name: string; status: string } }>(`${trimSlash(cfg.url)}/zones/${encodeURIComponent(zone)}`, { headers }).catch(() => undefined),
    httpJson<{ data?: { viewer?: { zones?: { httpRequests1hGroups?: CfHour[] }[] } }; errors?: { message: string }[] | null }>(`${trimSlash(cfg.url)}/graphql`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: ZONE_QUERY, variables: { zone, since: new Date(now - 24 * 3600_000).toISOString().slice(0, 19) + "Z" } }),
    }),
  ]);
  if (gql.errors?.length) throw new Error(gql.errors[0].message);
  const z0 = gql.data?.viewer?.zones?.[0];
  if (!z0) throw new Error("Zone not found, or the token can't read its analytics");
  return parseZone(z0.httpRequests1hGroups ?? [], info?.result);
}

export const cloudflare: Integration<typeof schema> = {
  type: "cloudflare",
  schema,
  async fetch(cfg) {
    let tunnels: WidgetResult | undefined;
    if (cfg.tunnels && cfg.account) {
      const q = new URLSearchParams({ is_deleted: "false", per_page: "100" });
      if (cfg.tunnel) q.set("name", cfg.tunnel);
      const r = await httpJson<{ success: boolean; result: CfTunnel[]; errors?: { message: string }[] }>(
        `${trimSlash(cfg.url)}/accounts/${encodeURIComponent(cfg.account)}/cfd_tunnel?${q}`,
        { headers: { Authorization: `Bearer ${cfg.key}` } },
      );
      if (!r.success) throw new Error(r.errors?.[0]?.message ?? "Cloudflare API error");
      tunnels = parseCloudflare(r.result);
    }
    const zone = cfg.zone ? await zoneTraffic(cfg, cfg.zone) : [];
    if (!tunnels) return { fields: zone };
    // Both: tunnel health first, then the zone's traffic.
    return { fields: [...tunnels.fields, ...zone], list: tunnels.list };
  },
};
