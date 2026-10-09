import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handshakeSeconds, parseWgDashboard, wgdashboard, type WgdConfiguration, type WgdPeer } from "@/integrations/wgdashboard";
import { integrations } from "@/integrations";
import { integrationFields } from "@/integrations/fields";
import wgd from "./fixtures/wgdashboard.json";

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
