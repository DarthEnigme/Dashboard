import { describe, expect, it } from "vitest";
import { bucketizeHourly, overallUptime, percentile, rollupHour, usesRollups } from "@/lib/history";
import { proxmoxActions } from "@/integrations/proxmox";
import { dockerActions } from "@/integrations/docker";
import pve from "./fixtures/proxmox-resources.json";

describe("long history", () => {
  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95)).toBe(95);
  });

  it("rolls an hour of pings up, ignoring latency of failed checks", () => {
    const rows = [
      { ts: 0, up: 1, latency_ms: 10 },
      { ts: 1, up: 1, latency_ms: 30 },
      { ts: 2, up: 0, latency_ms: 5000 },
      { ts: 3, up: 0, latency_ms: null },
    ];
    expect(rollupHour(rows)).toEqual({ checks: 4, up: 2, avg_ms: 20, p95_ms: 30 });
  });

  it("buckets hourly rollups, weighting by checks", () => {
    const H = 3_600_000;
    const hours = [
      { hour: 0, checks: 100, up: 100, avg_ms: 10, p95_ms: 20 },
      { hour: H, checks: 100, up: 50, avg_ms: 30, p95_ms: 90 },
      { hour: 2 * H, checks: 0, up: 0, avg_ms: null, p95_ms: null },
    ];
    const [a, b] = bucketizeHourly(hours, 0, 4 * H, 2);
    expect(a.uptime).toBe(0.75);
    // (10*100 + 30*50) / 150
    expect(a.avgLatency).toBe(17);
    expect(a.p95Latency).toBe(90);
    expect(b.uptime).toBeNull();
    expect(overallUptime([a, b])).toBe(0.75);
  });

  it("uses rollups only beyond the raw retention", () => {
    expect(usesRollups("24h")).toBe(false);
    expect(usesRollups("7d")).toBe(false);
    expect(usesRollups("30d")).toBe(true);
  });
});

describe("actions", () => {
  it("offers power actions per Proxmox guest based on its state, skipping templates", () => {
    const actions = proxmoxActions(pve.data);
    const byGuest = (name: string) => actions.filter((a) => a.targetLabel?.startsWith(name)).map((a) => a.id);
    expect(byGuest("home-assistant")).toEqual(["shutdown", "reboot", "stop", "snapshot"]);
    expect(byGuest("win11")).toEqual(["start", "snapshot"]);
    expect(byGuest("template-debian")).toEqual([]);
    expect(actions.find((a) => a.id === "stop")?.danger).toBe(true);
    expect(actions.find((a) => a.targetLabel === "jellyfin (LXC)")?.target).toBe("pve1/lxc/107");
    expect(proxmoxActions(pve.data, "pve2").map((a) => a.targetLabel)).toEqual(["truenas", "truenas", "truenas", "truenas"]);
  });

  it("offers start for stopped containers and restart/stop for running ones", () => {
    expect(dockerActions("exited").map((a) => a.id)).toEqual(["start"]);
    expect(dockerActions("running").map((a) => a.id)).toEqual(["restart", "stop"]);
  });
});

describe("action metadata", () => {
  it("ACTION_TYPES matches the integrations that implement actions", async () => {
    const { integrations } = await import("@/integrations");
    const { ACTION_TYPES } = await import("@/integrations/fields");
    const withActions = Object.values(integrations).filter((i) => i.actions).map((i) => i.type);
    expect(new Set(withActions)).toEqual(ACTION_TYPES);
  });
});
