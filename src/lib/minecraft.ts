import crypto from "node:crypto";
import dgram from "node:dgram";
import net from "node:net";

/**
 * Minecraft server status without a plugin or query port:
 * Java edition: the server-list ping over TCP (what the multiplayer screen does);
 * Bedrock edition: the RakNet "unconnected ping" over UDP.
 */

export interface McStatus {
  edition: "java" | "bedrock";
  version: string;
  online: number;
  max: number;
  motd: string;
  /** A sample of who is online (Java servers send up to 12 names). */
  players: string[];
  latencyMs: number;
}

// --- Java ---

export function varint(n: number): Buffer {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

/** A varint at `at`, or undefined when the buffer ends first. */
export function readVarint(buf: Buffer, at = 0): { value: number; size: number } | undefined {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (at + i >= buf.length) return undefined;
    const b = buf[at + i];
    value |= (b & 0x7f) << (7 * i);
    if (!(b & 0x80)) return { value: value >>> 0, size: i + 1 };
  }
  throw new Error("Bad varint from the server");
}

const packet = (id: number, ...parts: Buffer[]) => {
  const body = Buffer.concat([varint(id), ...parts]);
  return Buffer.concat([varint(body.length), body]);
};
const mcString = (s: string) => Buffer.concat([varint(Buffer.byteLength(s)), Buffer.from(s, "utf8")]);

/** Handshake (protocol -1: "any", next state 1: status) followed by the status request. */
export function javaStatusRequest(host: string, port: number): Buffer {
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);
  return Buffer.concat([packet(0x00, varint(-1), mcString(host), portBuf, varint(1)), packet(0x00)]);
}

/** Chat components (or a plain string) to plain text, without § formatting codes. */
export function chatText(c: unknown): string {
  if (typeof c === "string") return c.replace(/§./g, "");
  if (Array.isArray(c)) return c.map(chatText).join("");
  if (c && typeof c === "object") {
    const o = c as { text?: unknown; extra?: unknown[]; translate?: string };
    return chatText(o.text ?? o.translate ?? "") + (o.extra ? chatText(o.extra) : "");
  }
  return "";
}

export function parseJavaStatus(json: string, latencyMs: number): McStatus {
  const s = JSON.parse(json) as {
    version?: { name?: string };
    players?: { online?: number; max?: number; sample?: { name?: string }[] };
    description?: unknown;
  };
  return {
    edition: "java",
    version: chatText(s.version?.name ?? ""),
    online: s.players?.online ?? 0,
    max: s.players?.max ?? 0,
    motd: chatText(s.description ?? "").replace(/\s+/g, " ").trim(),
    players: (s.players?.sample ?? []).map((p) => p.name ?? "").filter((n) => n && !/^§/.test(n)),
    latencyMs,
  };
}

/** If `buf` holds a whole status response packet, its JSON. */
export function javaStatusJson(buf: Buffer): string | undefined {
  const len = readVarint(buf);
  if (!len || buf.length < len.size + len.value) return undefined;
  let at = len.size;
  const id = readVarint(buf, at)!;
  if (id.value !== 0) throw new Error("Unexpected reply from the server");
  at += id.size;
  const strLen = readVarint(buf, at)!;
  at += strLen.size;
  return buf.toString("utf8", at, at + strLen.value);
}

export function javaStatus(host: string, port = 25565, timeoutMs = 5000): Promise<McStatus> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let buf = Buffer.alloc(0);
    const socket = net.connect({ host, port, timeout: timeoutMs });
    const fail = (e: Error) => {
      socket.destroy();
      reject(e);
    };
    socket.once("connect", () => socket.write(javaStatusRequest(host, port)));
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length > 1 << 20) return fail(new Error("Reply too large"));
      try {
        const json = javaStatusJson(buf);
        if (json === undefined) return;
        socket.destroy();
        resolve(parseJavaStatus(json, Math.round(performance.now() - start)));
      } catch (e) {
        fail(e as Error);
      }
    });
    socket.once("timeout", () => fail(Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })));
    socket.once("error", fail);
    socket.once("end", () => fail(new Error("The server closed the connection (not a Minecraft Java server?)")));
  });
}

// --- Bedrock ---

const MAGIC = Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex");

export function bedrockPing(): Buffer {
  const b = Buffer.alloc(1 + 8 + 16 + 8);
  b[0] = 0x01;
  b.writeBigInt64BE(BigInt(Date.now()), 1);
  MAGIC.copy(b, 9);
  crypto.randomBytes(8).copy(b, 25);
  return b;
}

/** "MCPE;motd;protocol;version;online;max;serverId;world;gamemode;…" from an unconnected pong. */
export function parseBedrockPong(b: Buffer, latencyMs: number): McStatus {
  if (b[0] !== 0x1c || b.length < 35 || !b.subarray(17, 33).equals(MAGIC)) throw new Error("Not a Minecraft Bedrock reply");
  const len = b.readUInt16BE(33);
  const parts = b.toString("utf8", 35, 35 + len).split(";");
  return {
    edition: "bedrock",
    motd: [parts[1], parts[7]].filter(Boolean).join(" · ").replace(/§./g, ""),
    version: parts[3] ?? "",
    online: Number(parts[4]) || 0,
    max: Number(parts[5]) || 0,
    players: [],
    latencyMs,
  };
}

export function bedrockStatus(host: string, port = 19132, timeoutMs = 5000): Promise<McStatus> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(net.isIPv6(host) ? "udp6" : "udp4");
    const start = performance.now();
    const timer = setTimeout(() => done(Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" })), timeoutMs);
    const done = (e?: Error, s?: McStatus) => {
      clearTimeout(timer);
      socket.close();
      if (e) reject(e);
      else resolve(s!);
    };
    socket.on("message", (msg) => {
      try {
        done(undefined, parseBedrockPong(msg, Math.round(performance.now() - start)));
      } catch (e) {
        done(e as Error);
      }
    });
    socket.on("error", (e) => done(e));
    socket.send(bedrockPing(), port, host, (e) => e && done(e));
  });
}

export const mcStatus = (edition: "java" | "bedrock", host: string, port?: number, timeoutMs?: number) =>
  edition === "bedrock" ? bedrockStatus(host, port, timeoutMs) : javaStatus(host, port, timeoutMs);
