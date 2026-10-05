import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";

const schema = z.object({
  /** API access token (admin console → Settings → Keys). */
  key: z.string().min(1),
  /** Tailnet name, or "-" for the key's default tailnet. */
  tailnet: z.string().default("-"),
  url: z.string().url().default("https://api.tailscale.com"),
  /** Node keys expiring within this many days are flagged. */
  expiryDays: z.number().min(1).default(14),
});

export interface TsDevice {
  name?: string;
  hostname?: string;
  lastSeen?: string;
  expires?: string;
  keyExpiryDisabled?: boolean;
  updateAvailable?: boolean;
  connectedToControl?: boolean;
}

const DAY = 86_400_000;

/** Online devices (connected, or seen in the last 5 minutes), keys about to expire, client updates. */
export function parseTailscale(devices: TsDevice[], now: number, expiryDays: number): WidgetResult {
  const online = (d: TsDevice) => d.connectedToControl ?? (d.lastSeen ? now - Date.parse(d.lastSeen) < 5 * 60_000 : false);
  const keyDays = (d: TsDevice) => (d.keyExpiryDisabled || !d.expires || d.expires.startsWith("0001") ? Infinity : Math.floor((Date.parse(d.expires) - now) / DAY));
  const expiring = devices.filter((d) => keyDays(d) <= expiryDays);
  const updates = devices.filter((d) => d.updateAvailable).length;
  const name = (d: TsDevice) => d.hostname || d.name?.split(".")[0] || "?";
  return {
    fields: [
      { label: "Online", value: `${devices.filter(online).length} / ${devices.length}` },
      { label: "Key expiry", value: expiring.length, status: expiring.some((d) => keyDays(d) < 0) ? "error" : expiring.length ? "warn" : "ok" },
      { label: "Updates", value: updates, status: updates ? "warn" : "ok" },
    ],
    list: [...devices]
      .sort((a, b) => Number(online(b)) - Number(online(a)) || name(a).localeCompare(name(b)))
      .map((d) => {
        const k = keyDays(d);
        return {
          label: name(d),
          value: k <= expiryDays ? (k < 0 ? "key expired" : `key ${k} d`) : online(d) ? "online" : "offline",
          status: k < 0 ? ("error" as const) : k <= expiryDays || !online(d) ? ("warn" as const) : undefined,
        };
      }),
  };
}

export const tailscale: Integration<typeof schema> = {
  type: "tailscale",
  schema,
  async fetch(cfg) {
    const { devices } = await httpJson<{ devices: TsDevice[] }>(`${trimSlash(cfg.url)}/api/v2/tailnet/${encodeURIComponent(cfg.tailnet)}/devices?fields=all`, {
      headers: { Authorization: `Bearer ${cfg.key}` },
    });
    return parseTailscale(devices, Date.now(), cfg.expiryDays);
  },
};
