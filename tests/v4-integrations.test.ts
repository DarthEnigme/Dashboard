import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { instantValue, parsePrometheus, rangeValues, type PromInstant, type PromQuery, type PromRange, type PromTarget } from "@/integrations/prometheus";
import { parseGrafana, panelUrl, type GrafanaAlert } from "@/integrations/grafana";
import { parseGlances, shortUptime, type GlancesData } from "@/integrations/glances";
import { parseNetdata, type NetdataAlarm } from "@/integrations/netdata";
import { influxValues, parseInfluxMetrics, parseJsonMetrics } from "@/integrations/metric";
import { containerActions, containerTarget, parseContainers } from "@/integrations/containers";
import { fromArcane, type ArcaneContainer } from "@/integrations/arcane";
import { formatMetric, thresholdStatus } from "@/integrations/metrics";
import { uptimeSeconds } from "@/info/glances";
import { integrations } from "@/integrations";
import { integrationFields } from "@/integrations/fields";
import { infoProviders } from "@/info";
import { infoFields } from "@/info/fields";
import prom from "./fixtures/prometheus.json";
import grafanaAlerts from "./fixtures/grafana-alerts.json";
import gl from "./fixtures/glances.json";
import nd from "./fixtures/netdata.json";
import dockhandContainers from "./fixtures/dockhand-containers.json";
import arcaneList from "./fixtures/arcane-containers.json";

const fixture = (f: string) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const v = (fields: { label: string; value: string | number }[], label: string) => fields.find((f) => f.label === label)?.value;
const st = (fields: { label: string; status?: string }[], label: string) => fields.find((f) => f.label === label)?.status;

describe("metric formatting", () => {
  it("formats numbers, percentages, ratios, bytes and durations", () => {
    expect(formatMetric(42.5, "percent")).toBe("43%");
    expect(formatMetric(0.05, "ratio")).toBe("5.0%");
    expect(formatMetric(1536, "bytes")).toBe("1.5 KB");
    expect(formatMetric(2048, "bytesPerSec")).toBe("2.0 KB/s");
    expect(formatMetric(90_000, "duration")).toBe("1d 1h");
    expect(formatMetric(1234.567, "number")).toBe("1,235");
    expect(formatMetric(3.14159, "number", 2)).toBe("3.14");
    expect(formatMetric(undefined)).toBe("–");
    expect(formatMetric("NaN", "number")).toBe("NaN");
  });

  it("applies thresholds in both directions", () => {
    expect(thresholdStatus(50, {})).toBeUndefined();
    expect(thresholdStatus(80, { warn: 75, error: 90 })).toBe("warn");
    expect(thresholdStatus(95, { warn: 75, error: 90 })).toBe("error");
    expect(thresholdStatus(10, { warn: 20, error: 5, lowerIsWorse: true })).toBe("warn");
    expect(thresholdStatus(30, { warn: 20, error: 5, lowerIsWorse: true })).toBe("ok");
  });
});

describe("prometheus", () => {
  it("reads vectors, scalars and empty results", () => {
    expect(instantValue(prom.vector.data as PromInstant)).toBe(42.5);
    expect(instantValue(prom.scalar.data as PromInstant)).toBe(3);
    expect(instantValue(prom.empty.data as PromInstant)).toBeUndefined();
    expect(rangeValues(prom.range.data as PromRange)).toEqual([0.2, 0.35, 0.5]);
  });

  it("builds fields, sparklines and the targets summary", () => {
    const queries = [
      { label: "CPU", query: "x", format: "percent", warn: 40, error: 90 },
      { label: "Mem", query: "y", format: "ratio", chart: true },
      { label: "Missing", query: "z", format: "number" },
    ] as PromQuery[];
    const r = parsePrometheus(queries, [42.5, 0.5, undefined], [undefined, [0.2, 0.35, 0.5], undefined], prom.targets.data.activeTargets as PromTarget[]);
    expect(r.fields.map((f) => [f.label, f.value, f.status])).toEqual([
      ["CPU", "43%", "warn"],
      ["Mem", "50%", undefined],
      ["Missing", "–", undefined],
      ["Targets", "2 / 3", "error"],
    ]);
    expect(r.sparks).toEqual([{ label: "Mem", values: [20, 35, 50], current: "50%", unit: "%", max: 100 }]);
    expect(r.list).toEqual([{ label: "cadvisor · docker:8080", value: "down", status: "error" }]);
  });
});

describe("grafana", () => {
  it("counts firing and pending alerts and lists them", () => {
    const r = parseGrafana({ database: "ok", version: "12.2.0" }, grafanaAlerts.data.alerts as GrafanaAlert[], 14);
    expect(r.fields.map((f) => [f.label, f.value, f.status])).toEqual([
      ["Firing", 1, "error"],
      ["Pending", 1, "warn"],
      ["Dashboards", 14, undefined],
      ["Health", "12.2.0", "ok"],
    ]);
    expect(r.list?.map((l) => l.label)).toEqual(["DiskFull", "HighLoad"]);
  });

  it("shows only health without a token", () => {
    const r = parseGrafana({ database: "failing" }, undefined, undefined);
    expect(v(r.fields, "Firing")).toBe("–");
    expect(st(r.fields, "Health")).toBe("error");
  });

  it("builds solo panel URLs", () => {
    expect(panelUrl("http://grafana:3000/", { dashboard: "abc", panel: 2, from: "now-6h" })).toBe("http://grafana:3000/d-solo/abc/_?panelId=2&from=now-6h&to=now");
  });
});

describe("glances", () => {
  const data: GlancesData = { ...gl, cpuHistory: gl.cpuHistory.total.map(([, x]) => x as number) } as GlancesData;

  it("summarises CPU, RAM, fullest disk, hottest sensor, load and uptime", () => {
    const r = parseGlances(data);
    expect(r.fields.map((f) => [f.label, f.value, f.status])).toEqual([
      ["CPU", "23%", "ok"],
      ["RAM", "61%", "ok"],
      ["Disk", "93%", "error"],
      ["Temp", "78°", "warn"],
      ["Load", "0.98", "ok"],
      ["Uptime", "12d 3h", undefined],
    ]);
    expect(r.list?.map((l) => l.label)).toEqual(["/", "/mnt/tank"]); // tmpfs skipped
    expect(r.sparks?.[0].values).toEqual([12, 18.5, 23.4]);
  });

  it("limits disks to the configured mount points", () => {
    expect(parseGlances(data, ["/"]).list?.map((l) => l.label)).toEqual(["/"]);
  });

  it("parses uptime strings", () => {
    expect(shortUptime("3:04:05")).toBe("3h 4m");
    expect(shortUptime("1 day, 0:10:00")).toBe("1d 0h");
    expect(uptimeSeconds("1 day, 1:00:30")).toBe(90_030);
  });
});

describe("netdata", () => {
  it("sums CPU dimensions, computes RAM and lists alarms", () => {
    const r = parseNetdata(nd.cpu, nd.ram, nd.load, Object.values(nd.alarms.alarms) as NetdataAlarm[]);
    expect(r.fields.map((f) => [f.label, f.value, f.status])).toEqual([
      ["CPU", "28%", "ok"],
      ["RAM", "39%", "ok"],
      ["Load", "0.65", undefined],
      ["Alarms", 2, "error"],
    ]);
    // Oldest first, whatever order the API returns.
    expect(r.sparks?.[0].values.map((x) => Math.round(x))).toEqual([15, 28]);
    expect(r.list?.[0]).toEqual({ label: "disk_space_usage · disk_space./mnt/tank", value: "96.1%", status: "error" });
  });
});

describe("generic metric", () => {
  it("reads JSON paths with formats, thresholds and an array sparkline", () => {
    const r = parseJsonMetrics({ data: { load: [2.5, 1.2], hist: [1, 2, 3], name: "box" } }, [
      { label: "Load", path: "data.load[0]", format: "number", warn: 2 },
      { label: "Name", path: "data.name", format: "text" },
      { label: "Trend", path: "data.hist[2]", format: "number", chart: "data.hist" },
    ]);
    expect(r.fields.map((f) => [f.label, f.value, f.status])).toEqual([
      ["Load", "2.5", "warn"],
      ["Name", "box", undefined],
      ["Trend", "3", undefined],
    ]);
    expect(r.sparks?.[0].values).toEqual([1, 2, 3]);
  });

  it("reads _value from InfluxDB annotated CSV", () => {
    const values = influxValues(fixture("influx.csv"));
    expect(values).toEqual([410.5, 388, 452.25]);
    const r = parseInfluxMetrics([values], [{ label: "Power", format: "number", suffix: " W", chart: true }]);
    expect(r.fields[0].value).toBe("452 W");
    expect(r.sparks?.[0].current).toBe("452");
  });
});

describe("docker managers", () => {
  it("summarises Dockhand containers, problems first", () => {
    const r = parseContainers(dockhandContainers, { stacks: 3 });
    expect(r.fields.map((f) => [f.label, f.value])).toEqual([
      ["Running", 3],
      ["Stopped", 1],
      ["Unhealthy", 1],
      ["Stacks", 3],
    ]);
    expect(r.list?.map((l) => [l.label, l.value])).toEqual([
      ["immich_ml", "unhealthy"],
      ["immich_server", "healthy"],
      ["jellyfin", "running"],
      ["backup", "exited"],
    ]);
  });

  it("maps Arcane containers and counts image updates", () => {
    const cs = (arcaneList.data as ArcaneContainer[]).map(fromArcane);
    expect(cs.map((c) => c.name)).toEqual(["traefik", "vaultwarden", "old-app"]);
    const r = parseContainers(cs, { updates: true });
    expect(v(r.fields, "Updates")).toBe(1);
    expect(r.list?.find((l) => l.label.startsWith("traefik"))?.label).toBe("traefik ↑");
  });

  it("offers actions per container and validates targets", () => {
    const actions = containerActions(1, dockhandContainers);
    expect(actions.find((a) => a.targetLabel === "backup")).toMatchObject({ id: "start", target: "1/d4e5f6a1b2c3" });
    expect(actions.filter((a) => a.targetLabel === "jellyfin").map((a) => a.id)).toEqual(["restart", "stop"]);
    expect(containerTarget(1, "restart", "1/c3d4e5f6a1b2")).toBe("c3d4e5f6a1b2");
    expect(() => containerTarget(1, "restart", "2/c3d4e5f6a1b2")).toThrow(); // other environment
    expect(() => containerTarget(1, "remove", "1/c3d4e5f6a1b2")).toThrow();
    expect(() => containerTarget(1, "start", "1/../../etc")).toThrow();
  });
});

describe("registry", () => {
  it("registers every new integration and describes its fields", () => {
    for (const t of ["prometheus", "grafana", "glances", "netdata", "metric", "dockhand", "arcane"]) {
      expect(integrations[t]?.type).toBe(t);
      expect(integrationFields[t]?.fields.length).toBeGreaterThan(0);
    }
    for (const t of ["glances", "prometheus"]) {
      expect(infoProviders[t]?.type).toBe(t);
      expect(infoFields[t]).toBeDefined();
    }
  });

  it("accepts the editor's string values in schemas", () => {
    expect(integrations.glances.schema.parse({ url: "http://x:61208", version: "3" }).version).toBe(3);
    expect(integrations.arcane.schema.parse({ url: "http://x", key: "k", env: 2 }).env).toBe("2");
  });
});
