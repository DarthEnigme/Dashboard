import dgram from "node:dgram";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bedrockStatus, chatText, javaStatus, javaStatusJson, javaStatusRequest, parseBedrockPong, readVarint, varint } from "@/lib/minecraft";
import { runCheck, udpPayload } from "@/lib/checks";
import { integrations } from "@/integrations";
import { ACTION_TYPES, integrationFields } from "@/integrations/fields";
import { parsePelican, pelican, type PelicanResources } from "@/integrations/pelican";
import { parseWireguard, wireguard, type WgClient } from "@/integrations/wireguard";
import { minecraftResult } from "@/integrations/minecraft";
import { checkSchema } from "@/lib/config/schema";
import pelicanData from "./fixtures/pelican.json";
import wgFixture from "./fixtures/wgeasy-clients.json";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const wgClients = (now = NOW) =>
  (wgFixture as WgClient[]).map((c) => ({ ...c, latestHandshakeAt: c.latestHandshakeAt === "__RECENT__" ? new Date(now - 30_000).toISOString() : c.latestHandshakeAt }));
const v = (fields: { label: string; value: string | number }[], label: string) => fields.find((f) => f.label === label)?.value;

// --- a tiny Minecraft Java server: answers the status handshake like a real one ---
const javaReply = {
  version: { name: "Paper 1.21.4", protocol: 769 },
  players: { max: 20, online: 2, sample: [{ name: "Steve", id: "x" }, { name: "Alex", id: "y" }] },
  description: { text: "", extra: [{ text: "§aHome ", bold: true }, { text: "server" }] },
};

function mcJavaServer(): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        // Handshake + status request received: send the status response in two chunks.
        if (buf.length < 8) return;
        const json = Buffer.from(JSON.stringify(javaReply));
        const body = Buffer.concat([varint(0), varint(json.length), json]);
        const pkt = Buffer.concat([varint(body.length), body]);
        sock.write(pkt.subarray(0, 10));
        setTimeout(() => sock.end(pkt.subarray(10)), 20);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("minecraft protocol", () => {
  it("encodes and decodes varints, including -1", () => {
    for (const n of [0, 1, 127, 128, 255, 25565, 2_097_151]) expect(readVarint(varint(n))?.value).toBe(n);
    expect([...varint(-1)]).toEqual([0xff, 0xff, 0xff, 0xff, 0x0f]);
    expect(readVarint(Buffer.from([0x80]))).toBeUndefined(); // incomplete
  });

  it("builds the handshake and status request", () => {
    const b = javaStatusRequest("mc.local", 25565);
    const len = readVarint(b)!;
    expect(b[len.size]).toBe(0x00); // handshake id
    expect(b.includes(Buffer.from("mc.local"))).toBe(true);
    expect([...b.subarray(b.length - 2)]).toEqual([0x01, 0x00]); // status request
  });

  it("waits for the whole response, and reads chat components", () => {
    const json = Buffer.from('{"a":1}');
    const body = Buffer.concat([varint(0), varint(json.length), json]);
    const pkt = Buffer.concat([varint(body.length), body]);
    expect(javaStatusJson(pkt.subarray(0, 4))).toBeUndefined();
    expect(javaStatusJson(pkt)).toBe('{"a":1}');
    expect(chatText({ text: "§6Gold ", extra: ["and ", { text: "§lbold" }] })).toBe("Gold and bold");
  });

  it("talks to a Java server", async () => {
    const server = await mcJavaServer();
    const { port } = server.address() as AddressInfo;
    const s = await javaStatus("127.0.0.1", port);
    server.close();
    expect(s).toMatchObject({ edition: "java", version: "Paper 1.21.4", online: 2, max: 20, motd: "Home server", players: ["Steve", "Alex"] });
    const r = minecraftResult(s);
    expect(v(r.fields, "Players")).toBe("2 / 20");
    expect(r.list?.map((l) => l.label)).toEqual(["MOTD", "Steve", "Alex"]);
  });

  it("talks to a Bedrock server over UDP, and the minecraft and udp checks see it", async () => {
    const sock = dgram.createSocket("udp4");
    sock.on("message", (msg, from) => {
      if (msg[0] !== 0x01) return sock.send(Buffer.from("pong"), from.port, from.address); // plain UDP echo
      const motd = Buffer.from("MCPE;Bedrock house;766;1.21.50;3;10;12345;Survival;Survival;1;19132;19133;");
      const reply = Buffer.alloc(35);
      reply[0] = 0x1c;
      msg.copy(reply, 1, 1, 9); // echo the time
      Buffer.from("00ffff00fefefefefdfdfdfd12345678", "hex").copy(reply, 17);
      reply.writeUInt16BE(motd.length, 33);
      sock.send(Buffer.concat([reply, motd]), from.port, from.address);
    });
    await new Promise<void>((r) => sock.bind(0, "127.0.0.1", r));
    const { port } = sock.address();
    const s = await bedrockStatus("127.0.0.1", port);
    expect(s).toMatchObject({ edition: "bedrock", version: "1.21.50", online: 3, max: 10, motd: "Bedrock house · Survival" });
    expect((await runCheck(checkSchema.parse({ type: "minecraft", host: "127.0.0.1", port, edition: "bedrock" }))).up).toBe(true);
    expect((await runCheck(checkSchema.parse({ type: "udp", host: "127.0.0.1", port, payload: "hi", expect: "pong" }))).up).toBe(true);
    const wrong = await runCheck(checkSchema.parse({ type: "udp", host: "127.0.0.1", port, expect: "nope" }));
    expect(wrong).toMatchObject({ up: false, error: "reply without the expected text" });
    sock.close();
    expect(() => parseBedrockPong(Buffer.from("garbage-garbage-garbage-garbage-garbage"), 1)).toThrow(/Bedrock/);
  });

  it("reports a Java check against a closed port as down", async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    server.close();
    const r = await runCheck(checkSchema.parse({ type: "minecraft", host: "127.0.0.1", port }));
    expect(r.up).toBe(false);
  });

  it("reads UDP payloads as hex or text", () => {
    expect([...udpPayload(undefined)]).toEqual([0]);
    expect([...udpPayload("0x01ff")]).toEqual([1, 255]);
    expect(udpPayload("ping").toString()).toBe("ping");
  });
});

describe("pelican", () => {
  const states = new Map(Object.entries(pelicanData.resources).map(([k, r]) => [k, (r as PelicanResources).attributes]));

  it("summarises servers, offline first, with suspended and installing ones flagged", () => {
    const r = parsePelican(pelicanData.servers.data, states);
    expect(r.fields.map((f) => [f.label, f.value])).toEqual([
      ["Running", 1],
      ["Offline", 2],
      ["CPU", "43%"],
      ["Memory", "3.0 GB"],
    ]);
    expect(r.list?.map((l) => [l.label, l.value, l.status])).toEqual([
      ["Creative", "offline", "error"],
      ["Old world", "suspended", "error"],
      ["Valheim", "installing", "warn"],
      ["Survival", "43% · 3.0 GB · up 2h 3m", "ok"],
    ]);
  });

  describe("against the API", () => {
    let server: http.Server;
    let url = "";
    const power: unknown[] = [];
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const ok = req.headers.authorization === "Bearer ptlc_key";
        const send = (code: number, body: unknown) => {
          res.writeHead(code, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (!ok) return send(401, { errors: [{ detail: "Unauthenticated." }] });
        const m = /^\/api\/client\/servers\/([0-9a-f]{8})\/(resources|power)$/.exec(req.url ?? "");
        if (req.url?.startsWith("/api/client?")) return send(200, pelicanData.servers);
        if (m?.[2] === "resources") return send(200, (pelicanData.resources as Record<string, unknown>)[m[1]]);
        if (m?.[2] === "power") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            power.push({ id: m[1], ...JSON.parse(body) });
            res.writeHead(204).end();
          });
          return;
        }
        send(404, {});
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => server.close());

    it("offers power actions that fit each server's state, and sends them", async () => {
      const cfg = pelican.schema.parse({ url, key: "ptlc_key" });
      const actions = await pelican.actions!.list(cfg);
      expect(actions.map((a) => `${a.targetLabel}:${a.id}`)).toEqual(["Survival:restart", "Survival:stop", "Creative:start", "Valheim:start"]);
      expect(await pelican.actions!.run(cfg, "restart", "1a7ce997")).toBe("1a7ce997: restarting");
      expect(power).toEqual([{ id: "1a7ce997", signal: "restart" }]);
      await expect(pelican.actions!.run(cfg, "delete", "1a7ce997")).rejects.toThrow(/Unknown action/);
      await expect(pelican.actions!.run(cfg, "start", "../../admin")).rejects.toThrow(/Unknown server/);
      await expect(pelican.fetch(pelican.schema.parse({ url, key: "wrong" }), { serviceName: "x" })).rejects.toThrow();
    });
  });
});

describe("wireguard (wg-easy)", () => {
  it("counts connected peers by recent handshake, and lists them", () => {
    const r = parseWireguard(wgClients(), 3, NOW);
    expect(r.fields.map((f) => [f.label, f.value])).toEqual([
      ["Connected", 1],
      ["Peers", "3 / 4"],
      ["Received", "51 MB"],
      ["Sent", "302 MB"],
    ]);
    expect(r.list?.map((l) => [l.label, l.value])).toEqual([
      ["Phone", "online · 350 MB"],
      ["Laptop", "last seen 5h 0m ago"],
      ["NAS", "never connected"],
      ["Old tablet", "disabled"],
    ]);
  });

  describe("against the API", () => {
    let server: http.Server;
    let url = "";
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(code, { "Content-Type": "application/json", ...headers });
          res.end(JSON.stringify(body));
        };
        if (req.method === "POST" && req.url === "/api/session") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => (JSON.parse(body).password === "wg-pass" ? send(200, { success: true }, { "Set-Cookie": "connect.sid=s%3Aok; Path=/" }) : send(401, {})));
          return;
        }
        if (req.url === "/api/wireguard/client") return /connect\.sid=s%3Aok/.test(req.headers.cookie ?? "") ? send(200, wgClients(Date.now())) : send(401, {});
        if (req.url === "/api/client") {
          return req.headers.authorization === `Basic ${Buffer.from("admin:wg-pass").toString("base64")}` ? send(200, wgClients(Date.now())) : send(401, {});
        }
        send(404, {});
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => server.close());

    it("signs in to wg-easy 14 with a session cookie, and to 15 with Basic auth", async () => {
      const v14 = await wireguard.fetch(wireguard.schema.parse({ url, password: "wg-pass" }), { serviceName: "wg" });
      expect(v((v14 as { fields: [] }).fields, "Connected")).toBe(1);
      const v15 = await wireguard.fetch(wireguard.schema.parse({ url, username: "admin", password: "wg-pass" }), { serviceName: "wg" });
      expect(v((v15 as { fields: [] }).fields, "Peers")).toBe("3 / 4");
      await expect(wireguard.fetch(wireguard.schema.parse({ url, password: "nope" }), { serviceName: "wg" })).rejects.toThrow(/Wrong wg-easy password/);
    });
  });
});

describe("registry", () => {
  it("registers the new integrations, their fields, and Pelican's actions", () => {
    for (const t of ["wireguard", "pelican", "minecraft"]) {
      expect(integrations[t]?.type).toBe(t);
      expect(integrationFields[t]?.fields.length).toBeGreaterThan(0);
    }
    expect(ACTION_TYPES.has("pelican")).toBe(true);
    expect(checkSchema.parse({ type: "minecraft", host: "mc" })).toMatchObject({ edition: "java" });
  });
});

describe("liquid lens map", () => {
  it("is neutral in the middle, pushes inward at the rim, symmetric, and follows the corners", async () => {
    const { bezelFor, lensPixels } = await import("@/components/liquidLens");
    const lens = { width: 200, height: 100, radius: 20, bezel: 16 };
    const px = lensPixels(lens);
    const at = (x: number, y: number) => [px[(y * 200 + x) * 4], px[(y * 200 + x) * 4 + 1]];
    expect(at(100, 50)).toEqual([128, 128]); // middle
    expect(at(0, 50)[0]).toBeGreaterThan(220); // left rim samples to the right (inward)
    expect(at(199, 50)[0]).toBeLessThan(36); // right rim samples to the left
    expect(at(0, 50)[0] - 128).toBe(128 - at(199, 50)[0]); // symmetric
    expect(at(100, 0)[1]).toBeGreaterThan(220); // top pushes down
    expect(at(100, 30)).toEqual([128, 128]); // deeper than the bezel: flat
    const [cx, cy] = at(6, 6); // in the corner: diagonal, inward
    expect(cx).toBeGreaterThan(140);
    expect(cy).toBeGreaterThan(140);
    expect(bezelFor(560, 224)).toBe(32);
    expect(bezelFor(40, 30)).toBe(10);
  });
});

describe("logo", () => {
  it("versions the icon by logo, title and accent, and inlines PNG/JPEG uploads only", async () => {
    const { iconLogo, iconVersion } = await import("@/lib/logo");
    const { saveUpload } = await import("@/lib/uploads");
    const a = iconVersion({ title: "Lab", accent: "#8b5cf6" });
    expect(iconVersion({ title: "Lab", accent: "#8b5cf6", logo: "/x.png" })).not.toBe(a);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const url = await saveUpload("logos", new Blob([png]));
    expect(iconLogo(url)).toMatch(/^data:image\/png;base64,/);
    const webp = await saveUpload("logos", new Blob([new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")]));
    expect(iconLogo(webp)).toBeUndefined(); // the icon renderer can't draw WebP: the letter icon is used
    expect(iconLogo("https://example.com/logo.png")).toBe("https://example.com/logo.png");
    expect(iconLogo("/api/uploads/logos/../../secret.key")).toBeUndefined();
  });
});
