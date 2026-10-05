import { describe, expect, it } from "vitest";
import { getPath, parseCustom, formatValue } from "@/integrations/customapi";
import { parsePiholeV5, parsePiholeV6 } from "@/integrations/pihole";
import { parseAdGuard } from "@/integrations/adguard";
import { parseUnifi } from "@/integrations/unifi";
import { parseFirefly } from "@/integrations/firefly";
import { parseGhostfolio } from "@/integrations/ghostfolio";
import { parseProxmox } from "@/integrations/proxmox";
import { parseUptimeKuma } from "@/integrations/uptimekuma";
import pve from "./fixtures/proxmox-resources.json";
import kuma from "./fixtures/uptimekuma-heartbeat.json";
import pihole6 from "./fixtures/pihole-v6-summary.json";
import adguardStats from "./fixtures/adguard-stats.json";
import unifiHealth from "./fixtures/unifi-health.json";
import fireflySummary from "./fixtures/firefly-summary.json";

const v = (fields: { label: string; value: string | number }[], label: string) => fields.find((f) => f.label === label)?.value;

describe("customapi", () => {
  const data = { data: { users: [{ count: 1234.5 }], ratio: 42.123, size: 2048, up: 3700, name: "x" } };

  it("reads dotted and indexed paths", () => {
    expect(getPath(data, "data.users[0].count")).toBe(1234.5);
    expect(getPath(data, "data.users.0.count")).toBe(1234.5);
    expect(getPath(data, "data.missing.deep")).toBeUndefined();
  });

  it("formats mapped fields", () => {
    const f = parseCustom(data, [
      { label: "Users", field: "data.users[0].count", format: "number" },
      { label: "Ratio", field: "data.ratio", format: "percent" },
      { label: "Size", field: "data.size", format: "bytes" },
      { label: "Up", field: "data.up", format: "duration" },
      { label: "Temp", field: "data.ratio", format: "text", suffix: "°C" },
      { label: "Gone", field: "nope", format: "text", suffix: "x" },
    ]);
    expect(f.map((x) => x.value)).toEqual(["1,234.5", "42%", "2.0 KB", "1h 1m", "42.123°C", "–"]);
  });

  it("shows top-level scalars without mappings", () => {
    expect(parseCustom({ a: 1, b: "two", c: { nested: true } }, [])).toEqual([
      { label: "a", value: "1" },
      { label: "b", value: "two" },
    ]);
    expect(formatValue(null, "number")).toBe("–");
  });
});

describe("pi-hole", () => {
  it("parses v6 summary", () => {
    const f = parsePiholeV6(pihole6);
    expect(v(f, "Queries")).toBe("12,345");
    expect(v(f, "Blocked %")).toBe("15.4%");
    expect(v(f, "Clients")).toBe(9);
  });

  it("parses v5 summaryRaw", () => {
    const f = parsePiholeV5({ dns_queries_today: 1000, ads_blocked_today: 250, ads_percentage_today: 25, unique_clients: 4 });
    expect(f.map((x) => x.value)).toEqual(["1,000", "250", "25.0%", 4]);
  });
});

describe("adguard", () => {
  it("adds safe-browsing and parental blocks and converts latency", () => {
    const f = parseAdGuard(adguardStats);
    expect(v(f, "Blocked")).toBe("2,100");
    expect(v(f, "Blocked %")).toBe("21.0%");
    expect(v(f, "Latency")).toBe("12.5 ms");
  });
});

describe("unifi", () => {
  it("sums clients and devices across subsystems", () => {
    const f = parseUnifi(unifiHealth.data);
    expect(v(f, "Clients")).toBe(31);
    expect(v(f, "Devices")).toBe("5 / 6");
    expect(f.find((x) => x.label === "Devices")?.status).toBe("warn");
    expect(v(f, "WAN")).toBe("Up");
    expect(v(f, "Latency")).toBe("14 ms");
  });
});

describe("firefly", () => {
  it("uses the first currency by default and flags negative balances", () => {
    const f = parseFirefly(fireflySummary);
    expect(v(f, "Balance")).toBe("-€120.00");
    expect(f.find((x) => x.label === "Balance")?.status).toBe("error");
    expect(v(f, "Net worth")).toBe("€15,000.00");
  });

  it("picks a configured currency", () => {
    expect(v(parseFirefly(fireflySummary, "usd"), "Spent")).toBe("$50.00");
  });
});

describe("ghostfolio", () => {
  it("shows net worth and returns", () => {
    const f = parseGhostfolio(
      { performance: { currentNetWorth: 123456.7, netPerformancePercentageWithCurrencyEffect: -0.0123 } },
      { performance: { netPerformancePercentage: 0.25 } },
      "USD",
    );
    expect(f.map((x) => x.value)).toEqual(["$123,457", "-1.23%", "+25.00%"]);
    expect(f[1].status).toBe("error");
  });
});

describe("detail lists for large tiles", () => {
  it("lists proxmox guests, running first", () => {
    const { list } = parseProxmox(pve.data);
    expect(list?.length).toBe(5);
    expect(list?.slice(0, 3).every((r) => r.status === undefined)).toBe(true);
    // Unnamed guests fall back to their id, never "undefined".
    expect(parseProxmox([{ type: "lxc", vmid: 105, status: "stopped" }]).list?.[0].label).toBe("#105 (LXC)");
  });

  it("lists kuma monitors with names when the status page is available", () => {
    const { list } = parseUptimeKuma(kuma, { publicGroupList: [{ monitorList: [{ id: 1, name: "Router" }] }] });
    expect(list?.[0]).toEqual({ label: "Router", value: "Up · 99%", status: undefined });
    expect(list?.[1]).toMatchObject({ label: "Monitor 2", status: "error" });
  });
});
