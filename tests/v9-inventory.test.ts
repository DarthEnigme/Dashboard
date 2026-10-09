import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { CONFIG_DIR } from "@/lib/config/load";
import { magicPacket, normalizeMac, wake, wakeTarget } from "@/lib/wol";
import { addDevice, devicesCsv, importDevices, listDevices, updateDevice, warrantyJob } from "@/lib/inventory/store";

beforeEach(() => {
  db().exec("DELETE FROM devices; DELETE FROM app_meta WHERE key LIKE 'warranty:%';");
});

describe("Wake-on-LAN", () => {
  it("reads MACs in the usual notations", () => {
    expect(normalizeMac("aa:bb:cc:dd:ee:ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMac("AA-BB-CC-DD-EE-FF")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMac("aabb.ccdd.eeff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMac("aa:bb:cc")).toBeUndefined();
    expect(wakeTarget("192.168.1.255:7")).toEqual({ host: "192.168.1.255", port: 7 });
    expect(wakeTarget(undefined)).toEqual({ host: "255.255.255.255", port: 9 });
  });

  it("builds the magic packet and sends it", async () => {
    const p = magicPacket("01:23:45:67:89:ab");
    expect(p.length).toBe(102);
    expect(p.subarray(0, 6).toString("hex")).toBe("ffffffffffff");
    expect(p.subarray(96).toString("hex")).toBe("0123456789ab");
    const got: Buffer[] = [];
    const sock = dgram.createSocket("udp4").on("message", (m) => got.push(m));
    await new Promise<void>((r) => sock.bind(0, "127.0.0.1", r));
    const port = (sock.address() as AddressInfo).port;
    expect(await wake("01-23-45-67-89-AB", `127.0.0.1:${port}`)).toMatch(/01:23:45:67:89:AB via 127.0.0.1/);
    await new Promise((r) => setTimeout(r, 100));
    sock.close();
    expect(got.length).toBe(3);
    expect(got[0].equals(p)).toBe(true);
  });
});

describe("inventory", () => {
  it("validates devices", () => {
    expect(() => addDevice({})).toThrow(/Name required/);
    expect(() => addDevice({ name: "x", mac: "nope" })).toThrow(/Not a MAC/);
    expect(() => addDevice({ name: "x", ip: "1.2.3.4; rm -rf" })).toThrow(/IP must be/);
    expect(() => addDevice({ name: "x", check_port: 70000 })).toThrow(/Port/);
    expect(() => addDevice({ name: "x", warranty_until: "next year" })).toThrow(/YYYY-MM-DD/);
    const [d] = addDevice({ name: "NAS", kind: "nas", ip: "10.0.0.5", mac: "aa-bb-cc-dd-ee-ff", price: "349,90", location: "Rack" });
    expect(d).toMatchObject({ name: "NAS", kind: "nas", mac: "AA:BB:CC:DD:EE:FF", price_cents: 34990 });
    const [u] = updateDevice(d.id, { location: "Office" });
    expect(u).toMatchObject({ location: "Office", price_cents: 34990, mac: "AA:BB:CC:DD:EE:FF" });
  });

  it("exports CSV that imports back, updating by MAC", () => {
    addDevice({ name: "NAS", mac: "AA:BB:CC:DD:EE:FF", ip: "10.0.0.5", notes: "=cmd()" });
    addDevice({ name: "Router", ip: "10.0.0.1" });
    const csv = devicesCsv();
    expect(csv.split("\r\n")[0]).toContain("name,kind,ip,mac");
    expect(csv).toContain("'=cmd()"); // formulas stay text in spreadsheets
    const again = importDevices(csv);
    expect(again).toEqual({ added: 0, updated: 2, errors: [] });
    expect(listDevices().find((d) => d.name === "NAS")?.notes).toBe("=cmd()");
    const r = importDevices("Name,IP,MAC\nPrinter,10.0.0.9,11:22:33:44:55:66\nBroken,,zz\n,,\n");
    expect(r.added).toBe(1);
    expect(r.errors).toEqual(["Line 3: Not a MAC address: zz"]);
    expect(() => importDevices("ip,mac\n1.2.3.4,\n")).toThrow(/including name/);
  });

  describe("warranty reminders", () => {
    let server: http.Server;
    const hooks: { message: string; kind: string }[] = [];
    const settings = path.join(CONFIG_DIR, "settings.yaml");
    let before: string | undefined;
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => {
          hooks.push(JSON.parse(b));
          res.end("ok");
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      before = fs.existsSync(settings) ? fs.readFileSync(settings, "utf8") : undefined;
      fs.writeFileSync(settings, `title: Test\nalerts:\n  webhook: http://127.0.0.1:${(server.address() as AddressInfo).port}/hook\ninventory:\n  warrantyDays: 30\n`);
    });
    afterAll(() => {
      server.close();
      if (before === undefined) fs.rmSync(settings, { force: true });
      else fs.writeFileSync(settings, before);
    });

    it("tells the alert channels once, a month before", async () => {
      const now = new Date("2026-10-09T12:00:00Z");
      addDevice({ name: "Laptop", warranty_until: "2026-10-30" });
      addDevice({ name: "Old TV", warranty_until: "2026-01-01" });
      addDevice({ name: "New phone", warranty_until: "2028-01-01" });
      await warrantyJob(now);
      await warrantyJob(now);
      expect(hooks.map((h) => [h.kind, h.message])).toEqual([["warranty", "The warranty of Laptop ends in 21 days (2026-10-30)."]]);
    });
  });
});
