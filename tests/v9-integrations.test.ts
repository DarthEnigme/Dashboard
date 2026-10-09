import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handshakeSeconds, parseWgDashboard, wgdashboard, type WgdConfiguration, type WgdPeer } from "@/integrations/wgdashboard";
import { integrations } from "@/integrations";
import { integrationFields } from "@/integrations/fields";
import wgd from "./fixtures/wgdashboard.json";
import { cloudflare, parseZone, type CfHour } from "@/integrations/cloudflare";
import { controlFor, haActions, homeassistant, parseHomeAssistant, type HaState } from "@/integrations/homeassistant";
import { ACTION_TYPES } from "@/integrations/fields";

const configs = wgd.configurations.data as WgdConfiguration[];
const peers = Object.fromEntries(Object.entries(wgd.peers).map(([k, v]) => [k, v.data.configurationPeers as WgdPeer[]]));
const fields = (r: { fields: { label: string; value: unknown }[] }) => r.fields.map((f) => [f.label, f.value]);

describe("wgdashboard", () => {
  it("reads WGDashboard's handshake times", () => {
    expect(handshakeSeconds("0:00:41")).toBe(41);
    expect(handshakeSeconds("5:00:12")).toBe(5 * 3600 + 12);
    expect(handshakeSeconds("2 days, 3:04:05")).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    expect(handshakeSeconds("1 day, 0:00:00")).toBe(86400);
    expect(handshakeSeconds("No Handshake")).toBeUndefined();
  });

  it("totals every interface and lists peers, online first", () => {
    const r = parseWgDashboard(configs, peers);
    expect(fields(r)).toEqual([
      ["Connected", 2],
      ["Peers", "2 / 6"],
      ["Interfaces", "1 / 2"],
      ["Received", "256 MB"],
      ["Sent", "1.3 GB"],
    ]);
    expect(r.fields.find((f) => f.label === "Interfaces")?.status).toBe("warn");
    expect(r.list?.map((l) => [l.label, l.value])).toEqual([
      ["Phone (wg0)", "online · 358 MB"],
      ["g+h/i= (wg0)", "online · 1.0 MB"],
      ["Laptop (wg0)", "last seen 5h 0m ago"],
      ["Travel router (wg0)", "last seen 2d 3h ago"],
      ["Old tablet (wg0)", "never connected"],
    ]);
  });

  it("drops the interface suffix with one interface, and hides the interface count when it's up", () => {
    const r = parseWgDashboard([configs[0]], { wg0: peers.wg0 });
    expect(fields(r).map(([l]) => l)).toEqual(["Connected", "Peers", "Received", "Sent"]);
    expect(r.list?.[0].label).toBe("Phone");
  });

  it("never passes the peers' keys on", () => {
    const out = JSON.stringify(parseWgDashboard(configs, peers));
    expect(out).not.toContain("SECRET");
  });

  describe("against the API", () => {
    let server: http.Server;
    let url = "";
    const seen: string[] = [];
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const send = (body: unknown) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        };
        seen.push(req.url ?? "");
        if (req.headers["wg-dashboard-apikey"] !== "good") return send({ status: false, message: "Unauthorized access", data: null });
        const u = new URL(req.url ?? "/", "http://x");
        if (u.pathname === "/prefix/api/getWireguardConfigurations") return send(wgd.configurations);
        if (u.pathname === "/prefix/api/getWireguardConfigurationInfo") {
          const name = u.searchParams.get("configurationName") as keyof typeof wgd.peers;
          return send(wgd.peers[name]);
        }
        res.writeHead(404).end();
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/prefix`;
    });
    afterAll(() => server.close());

    it("sends the API key, follows the path prefix and fetches each interface's peers", async () => {
      const r = (await wgdashboard.fetch(wgdashboard.schema.parse({ url, key: "good" }), { serviceName: "vpn" })) as { fields: []; list: [] };
      expect(fields(r)[1]).toEqual(["Peers", "2 / 6"]);
      expect(r.list).toHaveLength(5);
      expect(seen).toContain("/prefix/api/getWireguardConfigurationInfo?configurationName=wg-guests");
    });

    it("can show a single interface", async () => {
      const r = (await wgdashboard.fetch(wgdashboard.schema.parse({ url, key: "good", config: "wg-guests" }), { serviceName: "vpn" })) as { fields: [] };
      expect(fields(r)[1]).toEqual(["Peers", "0 / 1"]);
      await expect(wgdashboard.fetch(wgdashboard.schema.parse({ url, key: "good", config: "wg9" }), { serviceName: "vpn" })).rejects.toThrow(/No WireGuard configuration called wg9/);
    });

    it("reports a refused key", async () => {
      await expect(wgdashboard.fetch(wgdashboard.schema.parse({ url, key: "bad" }), { serviceName: "vpn" })).rejects.toThrow(/Unauthorized access/);
    });
  });

  it("is registered with editor fields, and its key is a secret", () => {
    expect(integrations.wgdashboard?.type).toBe("wgdashboard");
    expect(integrationFields.wgdashboard.fields.find((f) => f.key === "key")?.secret).toBe(true);
  });
});

describe("cloudflare zone traffic", () => {
  const hours: CfHour[] = [
    { sum: { requests: 12000, cachedRequests: 9000, bytes: 1024 ** 3, threats: 3 }, uniq: { uniques: 800 } },
    { sum: { requests: 8000, cachedRequests: 1000, bytes: 512 * 1024 ** 2, threats: 0 }, uniq: { uniques: 400 } },
  ];

  it("sums the last 24 hours", () => {
    expect(parseZone(hours).map((f) => [f.label, f.value])).toEqual([
      ["Requests", "20.0k"],
      ["Cached", "50%"],
      ["Threats", "3"],
      ["Bandwidth", "1.5 GB"],
      ["Visitors", "1,200"],
    ]);
    expect(parseZone([], { status: "pending" })[0]).toEqual({ label: "Zone", value: "pending", status: "warn" });
    expect(parseZone([]).find((f) => f.label === "Cached")?.value).toBe("–");
  });

  it("needs an account or a zone", () => {
    expect(cloudflare.schema.safeParse({ key: "k" }).success).toBe(false);
    expect(cloudflare.schema.safeParse({ key: "k", zone: "z1" }).success).toBe(true);
    expect(cloudflare.schema.safeParse({ key: "k", account: "a", tunnels: false }).success).toBe(false);
  });

  describe("against the API", () => {
    let server: http.Server;
    let url = "";
    let gqlBody: { query: string; variables: { zone: string; since: string } } | undefined;
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const send = (body: unknown) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (req.headers.authorization !== "Bearer cf") return send({ success: false, errors: [{ message: "Invalid API Token" }] });
        if (req.url === "/zones/z1") return send({ success: true, result: { name: "example.com", status: "active" } });
        if (req.url === "/accounts/acc/cfd_tunnel?is_deleted=false&per_page=100")
          return send({ success: true, result: [{ name: "home", status: "healthy", connections: [{ colo_name: "cdg01" }] }] });
        if (req.method === "POST" && req.url === "/graphql") {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            gqlBody = JSON.parse(body);
            send(gqlBody!.variables.zone === "z1" ? { data: { viewer: { zones: [{ httpRequests1hGroups: hours }] } }, errors: null } : { data: { viewer: { zones: [] } }, errors: null });
          });
          return;
        }
        res.writeHead(404).end();
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => server.close());

    it("queries the zone's hourly traffic since 24 hours ago", async () => {
      const r = (await cloudflare.fetch(cloudflare.schema.parse({ key: "cf", zone: "z1", url }), { serviceName: "site" })) as { fields: { label: string; value: unknown }[] };
      expect(fields(r)[0]).toEqual(["Requests", "20.0k"]);
      expect(gqlBody?.query).toContain("httpRequests1hGroups");
      expect(Date.now() - Date.parse(gqlBody!.variables.since)).toBeGreaterThan(23.9 * 3600_000);
    });

    it("shows tunnels and the zone together", async () => {
      const r = (await cloudflare.fetch(cloudflare.schema.parse({ key: "cf", account: "acc", zone: "z1", url }), { serviceName: "site" })) as { fields: { label: string; value: unknown }[]; list: unknown[] };
      expect(r.fields.map((f) => f.label)).toEqual(["Healthy", "Connections", "Edges", "Requests", "Cached", "Threats", "Bandwidth", "Visitors"]);
      expect(r.list).toHaveLength(1);
    });

    it("explains a zone it can't read", async () => {
      await expect(cloudflare.fetch(cloudflare.schema.parse({ key: "cf", zone: "nope", url }), { serviceName: "site" })).rejects.toThrow(/Zone not found/);
    });
  });
});

describe("home assistant controls", () => {
  const st = (entity_id: string, state: string, name?: string): HaState => ({ entity_id, state, attributes: { friendly_name: name } });
  const states = [
    st("light.kitchen", "on", "Kitchen"),
    st("switch.heater", "off", "Heater"),
    st("cover.garage", "closed", "Garage door"),
    st("scene.movie", "2026-10-01T20:00:00+00:00", "Movie night"),
    st("script.goodnight", "off", "Good night"),
    st("sensor.temp", "21.4", "Temp"),
    st("light.broken", "unavailable", "Broken"),
  ];

  it("offers the action that fits each entity's state", () => {
    expect(controlFor(states[0])).toEqual({ action: "turn_off", target: "light.kitchen", on: true });
    expect(controlFor(states[1])).toEqual({ action: "turn_on", target: "switch.heater", on: false });
    expect(controlFor(states[2])).toEqual({ action: "open_cover", target: "cover.garage", on: false });
    expect(controlFor(states[3])).toEqual({ action: "turn_on", target: "scene.movie", label: "Activate" });
    expect(controlFor(states[5])).toBeUndefined();
    expect(controlFor(states[6])).toBeUndefined();
  });

  it("lists actions only for the configured entities", () => {
    const actions = haActions(states, ["light.kitchen", { entity: "scene.movie", label: "Cinema" }, "sensor.temp"]);
    expect(actions).toEqual([
      { id: "turn_off", label: "Turn off", target: "light.kitchen", targetLabel: "Kitchen" },
      { id: "turn_on", label: "Activate", target: "scene.movie", targetLabel: "Cinema" },
    ]);
  });

  it("puts controls on fields only when enabled; scenes show as scenes", () => {
    const on = parseHomeAssistant(states, ["light.kitchen", "scene.movie"], true);
    expect(on.fields[0].control?.action).toBe("turn_off");
    expect(on.fields[1].value).toBe("scene");
    expect(parseHomeAssistant(states, ["light.kitchen"], false).fields[0].control).toBeUndefined();
    expect(ACTION_TYPES.has("homeassistant")).toBe(true);
  });

  describe("against the API", () => {
    let server: http.Server;
    let url = "";
    const calls: { path: string; body: string; auth?: string }[] = [];
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          calls.push({ path: req.url ?? "", body, auth: req.headers.authorization });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(req.url === "/api/states" ? JSON.stringify(states) : "[]");
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => server.close());

    it("calls the domain's service with the entity", async () => {
      const cfg = homeassistant.schema.parse({ url, token: "t", entities: ["light.kitchen"] });
      expect(await homeassistant.actions!.run(cfg, "turn_off", "light.kitchen")).toBe("light.kitchen: turn off");
      expect(calls.at(-1)).toEqual({ path: "/api/services/light/turn_off", body: '{"entity_id":"light.kitchen"}', auth: "Bearer t" });
      expect(await homeassistant.actions!.list(cfg)).toHaveLength(1);
    });

    it("refuses anything outside the allowed services", async () => {
      const cfg = homeassistant.schema.parse({ url, token: "t", entities: ["light.kitchen"] });
      const before = calls.length;
      await expect(homeassistant.actions!.run(cfg, "unlock", "lock.front_door")).rejects.toThrow(/Can't unlock/);
      await expect(homeassistant.actions!.run(cfg, "turn_on", "lock.front_door")).rejects.toThrow();
      await expect(homeassistant.actions!.run(cfg, "turn_on", "../config")).rejects.toThrow();
      expect(calls.length).toBe(before);
      expect(await homeassistant.actions!.list(homeassistant.schema.parse({ url, token: "t", entities: ["light.kitchen"], controls: false }))).toEqual([]);
    });
  });
});
