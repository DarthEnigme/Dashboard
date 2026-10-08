import dgram from "node:dgram";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import { spawn } from "node:child_process";
import { http } from "./http";
import { cached } from "./cache";
import { snmpGet } from "./snmp";
import { mcStatus } from "./minecraft";
import type { CheckSpec, Service } from "./config/schema";

export interface CertInfo {
  /** ISO date the certificate stops being valid. */
  expires: string;
  daysLeft: number;
  issuer?: string;
  subject?: string;
}

export interface PingResult {
  up: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  /** When the result was measured (ms epoch). */
  at?: number;
  /** HTTPS checks: the server certificate (read at most every 6 hours). */
  cert?: CertInfo;
  /** Short extra detail, e.g. the SNMP value or the DNS answer. */
  detail?: string;
}

/**
 * The check for a service: `ping: true` checks the link, a string checks that URL (both over HTTP),
 * an object is a typed check (http, tcp, icmp, dns, snmp). An http object without url uses the link.
 */
export function checkSpec(s: Service | undefined): CheckSpec | undefined {
  const p = s?.ping;
  if (!p) return undefined;
  if (p === true) return s.href ? { type: "http", url: s.href, insecure: true } : undefined;
  if (typeof p === "string") return { type: "http", url: p, insecure: true };
  if (p.type === "http" && !p.url) return s.href ? { ...p, url: s.href } : undefined;
  return p;
}

/** Stable text for cache keys and the editor ("tcp 10.0.0.5:22"). */
export function describeCheck(c: CheckSpec): string {
  switch (c.type) {
    case "http":
      return c.url ?? "";
    case "tcp":
      return `tcp ${c.host}:${c.port}`;
    case "udp":
      return `udp ${c.host}:${c.port}`;
    case "minecraft":
      return `minecraft ${c.edition} ${c.host}${c.port ? `:${c.port}` : ""}`;
    case "icmp":
      return `icmp ${c.host}`;
    case "dns":
      return `dns ${c.record} ${c.host}${c.server ? ` @${c.server}` : ""}`;
    case "snmp":
      return `snmp ${c.host} ${c.oid}`;
  }
}

const errCode = (e: unknown) => {
  const err = e as Error & { code?: string; cause?: { code?: string } };
  return err.cause?.code ?? err.code ?? err.name ?? "error";
};

/** Walk "$.a.b[0].c" (or "a.b.0.c") into a parsed JSON value. */
export function jsonAt(data: unknown, path: string): unknown {
  const parts = path
    .replace(/^\$\.?/, "")
    .split(/[.[\]]/)
    .filter(Boolean);
  let cur: unknown = data;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const DAY = 86_400_000;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The certificate a TLS server presents (no verification: we only want its dates). */
export function readCert(host: string, port = 443, timeoutMs = 5000): Promise<CertInfo | undefined> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = socket.getPeerCertificate();
      socket.end();
      if (!c?.valid_to) return resolve(undefined);
      const expires = new Date(c.valid_to);
      resolve({
        expires: expires.toISOString(),
        daysLeft: Math.floor((expires.getTime() - Date.now()) / DAY),
        issuer: first(c.issuer?.O ?? c.issuer?.CN),
        subject: first(c.subject?.CN),
      });
    });
    socket.on("error", () => resolve(undefined));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(undefined);
    });
  });
}

async function checkHttp(c: Extract<CheckSpec, { type: "http" }>): Promise<PingResult> {
  const url = c.url!;
  const start = performance.now();
  const at = Date.now();
  const needBody = !!(c.keyword || c.jsonPath);
  try {
    let res = await http(url, { method: needBody ? "GET" : (c.method ?? "HEAD"), insecure: c.insecure, timeoutMs: 5000, redirect: "manual" });
    if (!needBody && (res.status === 405 || res.status === 501)) {
      await res.body?.cancel();
      res = await http(url, { method: "GET", insecure: c.insecure, timeoutMs: 5000, redirect: "manual" });
    }
    const latencyMs = Math.round(performance.now() - start);
    let up = c.expect?.length ? c.expect.includes(res.status) : res.status < 500;
    let error: string | undefined;
    if (needBody && up) {
      const text = (await res.text()).slice(0, 1_000_000);
      if (c.keyword && !text.includes(c.keyword)) {
        up = false;
        error = `"${c.keyword}" not found`;
      }
      if (up && c.jsonPath) {
        let value: unknown;
        try {
          value = jsonAt(JSON.parse(text), c.jsonPath);
        } catch {
          error = "not JSON";
          up = false;
        }
        if (up && (c.equals === undefined ? value === undefined || value === null || value === false : String(value) !== String(c.equals))) {
          up = false;
          error = `${c.jsonPath} = ${JSON.stringify(value)}`;
        }
      }
    } else {
      await res.body?.cancel();
    }
    if (!up && !error && c.expect?.length) error = `HTTP ${res.status}, expected ${c.expect.join("/")}`;
    const result: PingResult = { up, status: res.status, latencyMs, at, error };
    const u = new URL(url);
    if (u.protocol === "https:") {
      result.cert = await cached(`cert|${u.hostname}|${u.port}`, 6 * 3_600_000, () => readCert(u.hostname, Number(u.port || 443)));
      // Days left move on even while the cached read is old.
      if (result.cert) result.cert = { ...result.cert, daysLeft: Math.floor((Date.parse(result.cert.expires) - Date.now()) / DAY) };
    }
    return result;
  } catch (e) {
    return { up: false, error: errCode(e), at };
  }
}

function checkTcp(c: Extract<CheckSpec, { type: "tcp" }>): Promise<PingResult> {
  const start = performance.now();
  const at = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host: c.host, port: c.port, timeout: 5000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve({ up: true, latencyMs: Math.round(performance.now() - start), at });
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve({ up: false, error: "ETIMEDOUT", at });
    });
    socket.once("error", (e) => resolve({ up: false, error: errCode(e), at }));
  });
}

/** "0x0102ff" as bytes, anything else as UTF-8 text; empty: one zero byte. */
export function udpPayload(p: string | undefined): Buffer {
  if (!p) return Buffer.from([0]);
  if (/^0x([0-9a-f]{2})+$/i.test(p)) return Buffer.from(p.slice(2), "hex");
  return Buffer.from(p, "utf8");
}

/**
 * UDP has no handshake: a service is up when it answers. Many only answer their own protocol
 * (set `payload`); a closed port usually comes back as "ECONNREFUSED" (ICMP port unreachable).
 */
function checkUdp(c: Extract<CheckSpec, { type: "udp" }>): Promise<PingResult> {
  const start = performance.now();
  const at = Date.now();
  return new Promise((resolve) => {
    const socket = dgram.createSocket(net.isIPv6(c.host) ? "udp6" : "udp4");
    const finish = (r: PingResult) => {
      clearTimeout(timer);
      socket.close();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ up: false, error: "no reply", at }), 5000);
    socket.on("message", (msg) => {
      if (c.expect && !msg.toString("latin1").includes(c.expect)) return finish({ up: false, error: "reply without the expected text", at });
      finish({ up: true, latencyMs: Math.max(1, Math.round(performance.now() - start)), at });
    });
    socket.on("error", (e) => finish({ up: false, error: errCode(e), at }));
    // connect() so the OS reports "port unreachable" back to us as ECONNREFUSED.
    socket.connect(c.port, c.host, () => socket.send(udpPayload(c.payload)));
  });
}

async function checkMinecraft(c: Extract<CheckSpec, { type: "minecraft" }>): Promise<PingResult> {
  const at = Date.now();
  try {
    const s = await mcStatus(c.edition, c.host, c.port);
    return { up: true, latencyMs: Math.max(1, s.latencyMs), at };
  } catch (e) {
    return { up: false, error: errCode(e), at };
  }
}

/** Round-trip time from ping's output ("time=12.3 ms", "time<1ms", "Zeit=4ms"). */
export function parsePingTime(out: string): number | undefined {
  const m = out.match(/(?:time|zeit|temps|tiempo)[=<]\s*([\d.,]+)\s*ms/i);
  return m ? Math.max(1, Math.round(Number(m[1].replace(",", ".")))) : undefined;
}

function checkIcmp(c: Extract<CheckSpec, { type: "icmp" }>): Promise<PingResult> {
  const at = Date.now();
  if (!/^[\w.:-]+$/.test(c.host)) return Promise.resolve({ up: false, error: "invalid host", at });
  const args = process.platform === "win32" ? ["-n", "1", "-w", "3000", c.host] : ["-c", "1", "-W", "3", c.host];
  return new Promise((resolve) => {
    let out = "";
    const p = spawn("ping", args, { timeout: 6000 });
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => resolve({ up: false, error: errCode(e) === "ENOENT" ? "ping command not available" : errCode(e), at }));
    p.on("close", (code) => {
      const latencyMs = parsePingTime(out);
      if (code === 0 && latencyMs !== undefined) return resolve({ up: true, latencyMs, at });
      const denied = /permission|not permitted|operation not permitted/i.test(out);
      resolve({ up: false, error: denied ? "ICMP not permitted (use a tcp check)" : "no reply", at });
    });
  });
}

async function checkDns(c: Extract<CheckSpec, { type: "dns" }>): Promise<PingResult> {
  const at = Date.now();
  const start = performance.now();
  const r = new dns.promises.Resolver({ timeout: 4000, tries: 1 });
  if (c.server) {
    const [host, port] = c.server.includes("]") || (c.server.match(/:/g) ?? []).length > 1 ? [c.server, ""] : c.server.split(":");
    r.setServers([port ? `${host}:${port}` : host]);
  }
  try {
    const raw = await r.resolve(c.host, c.record);
    const answers = (raw as unknown[]).map((a) =>
      typeof a === "string" ? a : Array.isArray(a) ? a.join("") : typeof a === "object" && a && "exchange" in a ? String((a as { exchange: string }).exchange) : String(a),
    );
    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    if (c.expect && !answers.some((a) => a.toLowerCase() === c.expect!.toLowerCase())) {
      return { up: false, latencyMs, at, error: `got ${answers.join(", ") || "nothing"}`, detail: answers.join(", ") };
    }
    return { up: answers.length > 0, latencyMs, at, detail: answers.join(", ") };
  } catch (e) {
    return { up: false, error: errCode(e), at };
  }
}

async function checkSnmp(c: Extract<CheckSpec, { type: "snmp" }>): Promise<PingResult> {
  const at = Date.now();
  const start = performance.now();
  try {
    const [vb] = await snmpGet({ host: c.host, port: c.port, community: c.community, version: c.version }, [c.oid]);
    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    if (vb?.value === null || vb?.value === undefined) return { up: false, latencyMs, at, error: `no value for ${c.oid}` };
    return { up: true, latencyMs, at, detail: String(vb.value) };
  } catch (e) {
    return { up: false, error: /timed? ?out/i.test((e as Error).message) ? "ETIMEDOUT" : (e as Error).message, at };
  }
}

export function runCheck(c: CheckSpec): Promise<PingResult> {
  switch (c.type) {
    case "http":
      return checkHttp(c);
    case "tcp":
      return checkTcp(c);
    case "udp":
      return checkUdp(c);
    case "minecraft":
      return checkMinecraft(c);
    case "icmp":
      return checkIcmp(c);
    case "dns":
      return checkDns(c);
    case "snmp":
      return checkSnmp(c);
  }
}

/** HTTP reachability of a URL (kept for callers that only have a URL). */
export const ping = (url: string) => runCheck({ type: "http", url, insecure: true });
