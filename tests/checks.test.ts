import dgram from "node:dgram";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import snmp from "net-snmp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSpec, describeCheck, jsonAt, parsePingTime, runCheck } from "@/lib/checks";
import { counterRate, findInterface, OID, parseStorage, parseSupplies, snmpIntegration } from "@/integrations/snmp";
import { serviceSchema } from "@/lib/config/schema";

const svc = (o: Record<string, unknown>) => serviceSchema.parse({ name: "x", ...o });

describe("check specs", () => {
  it("keeps the old shorthands and fills in the link", () => {
    expect(checkSpec(svc({ href: "https://a", ping: true }))).toMatchObject({ type: "http", url: "https://a" });
    expect(checkSpec(svc({ ping: "http://b/health" }))).toMatchObject({ type: "http", url: "http://b/health" });
    expect(checkSpec(svc({ href: "https://a", ping: { type: "http", keyword: "ok" } }))).toMatchObject({ url: "https://a", keyword: "ok" });
    expect(checkSpec(svc({ ping: true }))).toBeUndefined();
    expect(describeCheck(checkSpec(svc({ ping: { type: "tcp", host: "nas", port: "22" } }))!)).toBe("tcp nas:22");
  });

  it("rejects incomplete typed checks", () => {
    expect(() => svc({ ping: { type: "tcp", host: "nas" } })).toThrow();
    expect(() => svc({ ping: { type: "gopher", host: "nas" } })).toThrow();
  });

  it("reads JSON paths and ping times", () => {
    expect(jsonAt({ a: { b: [{ c: 5 }] } }, "$.a.b[0].c")).toBe(5);
    expect(jsonAt({ a: 1 }, "a.x.y")).toBeUndefined();
    expect(parsePingTime("64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=0.412 ms")).toBe(1);
    expect(parsePingTime("Reply from 10.0.0.1: bytes=32 time=14ms TTL=64")).toBe(14);
    expect(parsePingTime("Antwort von 10.0.0.1: Bytes=32 Zeit<1ms TTL=64")).toBe(1);
    expect(parsePingTime("Request timed out.")).toBeUndefined();
  });
});

describe("http, tcp and dns checks", () => {
  let web: http.Server;
  let base = "";
  let dnsServer: dgram.Socket;
  let dnsPort = 0;

  beforeAll(async () => {
    web = http.createServer((req, res) => {
      if (req.url === "/health") return res.end(JSON.stringify({ status: "ok", checks: [{ ok: true }] }));
      if (req.url === "/text") return res.end("All systems operational");
      res.statusCode = 404;
      res.end("nope");
    });
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;

    // Minimal DNS server: answers every A question with 10.0.0.20.
    dnsServer = dgram.createSocket("udp4");
    dnsServer.on("message", (q, rinfo) => {
      let o = 12;
      while (q[o] !== 0) o += q[o] + 1;
      const question = q.subarray(12, o + 5);
      const header = Buffer.from([q[0], q[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
      const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 0, 0, 20]);
      dnsServer.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
    });
    await new Promise<void>((r) => dnsServer.bind(0, "127.0.0.1", r));
    dnsPort = dnsServer.address().port;
  });
  afterAll(() => {
    web.close();
    dnsServer.close();
  });

  it("http: status, expected codes, keyword and JSON value", async () => {
    expect((await runCheck({ type: "http", url: `${base}/missing`, insecure: true })).up).toBe(true); // 404 < 500
    const strict = await runCheck({ type: "http", url: `${base}/missing`, insecure: true, expect: [200] });
    expect(strict).toMatchObject({ up: false, status: 404, error: "HTTP 404, expected 200" });
    expect((await runCheck({ type: "http", url: `${base}/text`, insecure: true, keyword: "operational" })).up).toBe(true);
    expect(await runCheck({ type: "http", url: `${base}/text`, insecure: true, keyword: "degraded" })).toMatchObject({ up: false, error: '"degraded" not found' });
    expect((await runCheck({ type: "http", url: `${base}/health`, insecure: true, jsonPath: "$.status", equals: "ok" })).up).toBe(true);
    expect((await runCheck({ type: "http", url: `${base}/health`, insecure: true, jsonPath: "checks[0].ok" })).up).toBe(true);
    expect(await runCheck({ type: "http", url: `${base}/health`, insecure: true, jsonPath: "$.status", equals: "down" })).toMatchObject({ up: false, error: '$.status = "ok"' });
  });

  it("tcp: open and closed ports", async () => {
    const port = (web.address() as AddressInfo).port;
    expect(await runCheck({ type: "tcp", host: "127.0.0.1", port })).toMatchObject({ up: true });
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const freePort = (closed.address() as AddressInfo).port;
    closed.close();
    expect(await runCheck({ type: "tcp", host: "127.0.0.1", port: freePort })).toMatchObject({ up: false, error: "ECONNREFUSED" });
  });

  it("dns: resolves through a given server and checks the answer", async () => {
    const server = `127.0.0.1:${dnsPort}`;
    expect(await runCheck({ type: "dns", host: "nas.home.arpa", server, record: "A" })).toMatchObject({ up: true, detail: "10.0.0.20" });
    expect(await runCheck({ type: "dns", host: "nas.home.arpa", server, record: "A", expect: "10.0.0.21" })).toMatchObject({ up: false, error: "got 10.0.0.20" });
  });
});

describe("snmp", () => {
  let agent: ReturnType<typeof snmp.createAgent>;
  let port = 0;

  beforeAll(async () => {
    port = 20000 + Math.floor(Math.random() * 20000);
    agent = snmp.createAgent({ port, address: "127.0.0.1", disableAuthorization: false }, () => {});
    agent.getAuthorizer().addCommunity("public");
    const mib = agent.getMib();
    mib.registerProvider({ name: "sysUpTime", type: snmp.MibProviderType.Scalar, oid: "1.3.6.1.2.1.1.3", scalarType: snmp.ObjectType.TimeTicks, maxAccess: snmp.MaxAccess["read-only"] });
    mib.registerProvider({ name: "sysName", type: snmp.MibProviderType.Scalar, oid: "1.3.6.1.2.1.1.5", scalarType: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess["read-only"] });
    mib.setScalarValue("sysUpTime", 360000); // 1 hour in hundredths
    mib.setScalarValue("sysName", "switch-1");
    mib.registerProvider({
      name: "hrStorageEntry",
      type: snmp.MibProviderType.Table,
      oid: "1.3.6.1.2.1.25.2.3.1",
      maxAccess: snmp.MaxAccess["not-accessible"],
      tableColumns: [
        { number: 1, name: "hrStorageIndex", type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess["read-only"] },
        { number: 3, name: "hrStorageDescr", type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess["read-only"] },
        { number: 4, name: "hrStorageAllocationUnits", type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess["read-only"] },
        { number: 5, name: "hrStorageSize", type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess["read-only"] },
        { number: 6, name: "hrStorageUsed", type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess["read-only"] },
      ],
      tableIndex: [{ columnName: "hrStorageIndex" }],
    } as never);
    mib.addTableRow("hrStorageEntry", [1, "Physical memory", 1024, 1000, 900]);
    mib.addTableRow("hrStorageEntry", [31, "/", 4096, 1000, 250]);
    await new Promise((r) => setTimeout(r, 100));
  });
  afterAll(() => agent?.close());

  it("check: up with the value, down for a missing OID", async () => {
    expect(await runCheck({ type: "snmp", host: "127.0.0.1", port, community: "public", version: "2c", oid: "1.3.6.1.2.1.1.5.0" })).toMatchObject({ up: true, detail: "switch-1" });
    expect((await runCheck({ type: "snmp", host: "127.0.0.1", port, community: "public", version: "2c", oid: "1.3.6.1.2.1.1.9.0" })).up).toBe(false);
  });

  it("widget: system and storage presets", async () => {
    const cfg = (o: Record<string, unknown>) => snmpIntegration.schema.parse({ host: "127.0.0.1", port, ...o });
    const sys = await snmpIntegration.fetch(cfg({}), { serviceName: "s" });
    expect(Array.isArray(sys) ? sys : sys.fields).toEqual(expect.arrayContaining([{ label: "Uptime", value: "1h 0m" }, { label: "Name", value: "switch-1" }]));
    const st = await snmpIntegration.fetch(cfg({ preset: "storage" }), { serviceName: "s" });
    const fields = Array.isArray(st) ? st : st.fields;
    expect(fields[0]).toMatchObject({ label: "RAM", value: "90%", status: "error" });
    expect(fields[1]).toMatchObject({ label: "Disk /", value: "25%" });
  });

  it("counter rates, wraps and resets", () => {
    expect(counterRate(undefined, { value: 100n, at: 1000 })).toBeUndefined();
    expect(counterRate({ value: 1000n, at: 0 }, { value: 3000n, at: 2000 })).toBe(1000);
    expect(counterRate({ value: 2n ** 64n - 500n, at: 0 }, { value: 500n, at: 1000 })).toBe(1000);
    expect(counterRate({ value: 10n ** 12n, at: 0 }, { value: 5n, at: 1000 }, 32)).toBeUndefined(); // reboot, not a wrap
  });

  it("finds interfaces and parses supplies", () => {
    const names = [[{ oid: `${OID.ifName}.3`, value: "eth0" }], [{ oid: `${OID.ifDescr}.7`, value: "Port 5" }], []];
    expect(findInterface("ETH0", names)).toBe("3");
    expect(findInterface("port 5", names)).toBe("7");
    expect(findInterface(12, names)).toBe("12");
    expect(findInterface("wlan9", names)).toBeUndefined();
    const supplies = parseSupplies(
      [{ oid: `${OID.supplyDescr}.1`, value: "Black Toner" }, { oid: `${OID.supplyDescr}.2`, value: "Drum" }],
      [{ oid: `${OID.supplyMax}.1`, value: 100 }, { oid: `${OID.supplyMax}.2`, value: -2 }],
      [{ oid: `${OID.supplyLevel}.1`, value: 12 }, { oid: `${OID.supplyLevel}.2`, value: -3 }],
    );
    expect(supplies).toEqual([{ name: "Black Toner", level: 0.12 }, { name: "Drum", level: undefined }]);
    expect(parseStorage([{ oid: `${OID.hrStorageDescr}.1`, value: "x" }], [], [], [])).toEqual([]);
  });
});
