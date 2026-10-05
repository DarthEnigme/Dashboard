import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";

const schema = z.object({
  /** API token with Account → Cloudflare Tunnel → Read. */
  key: z.string().min(1),
  account: z.string().min(1),
  /** Only this tunnel (name); default: all of the account's tunnels. */
  tunnel: z.string().optional(),
  url: z.string().url().default("https://api.cloudflare.com/client/v4"),
});

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

export const cloudflare: Integration<typeof schema> = {
  type: "cloudflare",
  schema,
  async fetch(cfg) {
    const q = new URLSearchParams({ is_deleted: "false", per_page: "100" });
    if (cfg.tunnel) q.set("name", cfg.tunnel);
    const r = await httpJson<{ success: boolean; result: CfTunnel[]; errors?: { message: string }[] }>(
      `${trimSlash(cfg.url)}/accounts/${encodeURIComponent(cfg.account)}/cfd_tunnel?${q}`,
      { headers: { Authorization: `Bearer ${cfg.key}` } },
    );
    if (!r.success) throw new Error(r.errors?.[0]?.message ?? "Cloudflare API error");
    return parseCloudflare(r.result);
  },
};
