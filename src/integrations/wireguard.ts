import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";
import { bytes, duration } from "./format";

const schema = z.object({
  /** wg-easy's web UI. */
  url: z.string().url(),
  password: z.string().min(1),
  /** wg-easy 15+: the admin username (Basic auth). Leave empty for wg-easy 14 (password only). */
  username: z.string().optional(),
  /** A peer counts as connected when its last handshake is this recent (WireGuard re-handshakes every 2 minutes). */
  onlineMinutes: z.coerce.number().min(1).default(3),
  insecure: z.boolean().optional(),
});
type Cfg = z.infer<typeof schema>;

/** A client as wg-easy 14 (/api/wireguard/client) or 15 (/api/client) lists it. */
export interface WgClient {
  name: string;
  enabled: boolean;
  address?: string;
  ipv4Address?: string;
  latestHandshakeAt?: string | null;
  transferRx?: number | null;
  transferTx?: number | null;
  endpoint?: string | null;
}

export function parseWireguard(clients: WgClient[], onlineMinutes = 3, now = Date.now()): WidgetResult {
  const seen = (c: WgClient) => (c.latestHandshakeAt ? Date.parse(c.latestHandshakeAt) : NaN);
  const online = (c: WgClient) => c.enabled && now - seen(c) < onlineMinutes * 60_000;
  const rx = clients.reduce((t, c) => t + (c.transferRx ?? 0), 0);
  const tx = clients.reduce((t, c) => t + (c.transferTx ?? 0), 0);
  const connected = clients.filter(online).length;
  const enabled = clients.filter((c) => c.enabled).length;
  return {
    fields: [
      { label: "Connected", value: connected, raw: connected, status: "ok" },
      { label: "Peers", value: `${enabled} / ${clients.length}`, raw: enabled },
      // Server's view: what it received from peers is their upload.
      { label: "Received", value: bytes(rx), raw: rx },
      { label: "Sent", value: bytes(tx), raw: tx },
    ],
    list: [...clients]
      .sort((a, b) => Number(online(b)) - Number(online(a)) || (seen(b) || 0) - (seen(a) || 0) || a.name.localeCompare(b.name))
      .map((c) => ({
        label: c.name,
        value: !c.enabled
          ? "disabled"
          : online(c)
            ? `online · ${bytes((c.transferRx ?? 0) + (c.transferTx ?? 0))}`
            : Number.isNaN(seen(c))
              ? "never connected"
              : `last seen ${duration(Math.max(60, Math.round((now - seen(c)) / 1000)))} ago`,
        status: !c.enabled ? undefined : online(c) ? "ok" : "warn",
      })),
  };
}

/** wg-easy 15: Basic auth on /api/client. wg-easy 14: a session cookie from /api/session, then /api/wireguard/client. */
async function clients(cfg: Cfg): Promise<WgClient[]> {
  const base = trimSlash(cfg.url);
  if (cfg.username) {
    const auth = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`;
    return httpJson<WgClient[]>(`${base}/api/client`, { headers: { Authorization: auth }, insecure: cfg.insecure });
  }
  const login = await http(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: cfg.password }),
    insecure: cfg.insecure,
  });
  await login.body?.cancel();
  if (!login.ok) throw new Error(login.status === 401 ? "Wrong wg-easy password" : `HTTP ${login.status} from wg-easy`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return httpJson<WgClient[]>(`${base}/api/wireguard/client`, { headers: { Cookie: cookie }, insecure: cfg.insecure });
}

/** WireGuard through wg-easy: connected peers, traffic, and when each peer was last seen. */
export const wireguard: Integration<typeof schema> = {
  type: "wireguard",
  schema,
  async fetch(cfg) {
    return parseWireguard(await clients(cfg), cfg.onlineMinutes);
  },
};
