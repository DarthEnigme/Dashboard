import dgram from "node:dgram";

/** "aa:bb:cc:dd:ee:ff", "AA-BB-…", "aabb.ccdd.eeff" or "aabbccddeeff" → "AA:BB:CC:DD:EE:FF"; undefined if it isn't a MAC. */
export function normalizeMac(mac: string | null | undefined): string | undefined {
  const hex = (mac ?? "").replace(/[\s:.-]/g, "");
  if (!/^[0-9a-f]{12}$/i.test(hex)) return undefined;
  return hex.toUpperCase().match(/../g)!.join(":");
}

/** The Wake-on-LAN magic packet: six 0xFF bytes, then the MAC sixteen times (102 bytes). */
export function magicPacket(mac: string): Buffer {
  const m = normalizeMac(mac);
  if (!m) throw new Error(`Not a MAC address: ${mac}`);
  const bytes = Buffer.from(m.replace(/:/g, ""), "hex");
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

/** "192.168.1.255", "192.168.1.255:7" → host and port (default port 9, the discard port). */
export function wakeTarget(broadcast: string | null | undefined): { host: string; port: number } {
  const [host, port] = (broadcast?.trim() || "255.255.255.255").split(":");
  const p = Number(port ?? 9);
  return { host: host || "255.255.255.255", port: Number.isInteger(p) && p > 0 && p < 65536 ? p : 9 };
}

/**
 * Send the magic packet (three times: UDP may drop one). In Docker the broadcast only reaches the
 * LAN with `network_mode: host`; otherwise give the subnet's broadcast address of a routed network.
 */
export async function wake(mac: string, broadcast?: string | null): Promise<string> {
  const packet = magicPacket(mac);
  const { host, port } = wakeTarget(broadcast);
  const socket = dgram.createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(() => {
        socket.setBroadcast(true);
        resolve();
      });
    });
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((resolve, reject) => socket.send(packet, port, host, (e) => (e ? reject(e) : resolve())));
    }
  } finally {
    socket.close();
  }
  return `Wake-on-LAN sent to ${normalizeMac(mac)} via ${host}:${port}`;
}
