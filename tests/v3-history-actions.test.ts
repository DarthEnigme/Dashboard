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

describe("services removed from the config", () => {
  it("closes their open outage and forgets their state", async () => {
    const { dropStale } = await import("@/lib/monitor");
    const { incidentsSince, openIncident, openIncidents } = await import("@/lib/db");
    openIncident("infra.gone", 1000, "no response");
    openIncident("infra.kept", 1000, "no response");
    const state = {
      outages: new Map([
        ["infra.gone", { failures: 3, down: true, since: 1000 }],
        ["infra.kept", { failures: 3, down: true, since: 1000 }],
        ["infra.unchecked", { failures: 1, down: false, since: 1500 }],
      ]),
      certs: new Map([["infra.gone", { expires: "2030-01-01T00:00:00.000Z", daysLeft: 900 }]]),
      breaches: new Map([
        ["infra.gone|CPU", { firing: true }],
        ["infra.unchecked|Disk /|x", { firing: false }],
      ]),
    };
    // infra.unchecked is still in the config, but no longer has a status check.
    dropStale(state, new Set(["infra.kept"]), new Set(["infra.kept", "infra.unchecked"]), 5000);
    expect([...state.outages.keys()]).toEqual(["infra.kept"]);
    expect(state.certs.size).toBe(0);
    expect([...state.breaches.keys()]).toEqual(["infra.unchecked|Disk /|x"]);
    expect(openIncidents().map((i) => i.service_id)).toEqual(["infra.kept"]);
    expect(incidentsSince("infra.gone", 0)[0]).toMatchObject({ start: 1000, end: 5000 });
  });
});

describe("uptime per service", () => {
  it("counts checks and successes since a time, in one pass", async () => {
    const { insertPing, uptimeSince } = await import("@/lib/db");
    const ping = (service_id: string, ts: number, up: number) => insertPing({ service_id, ts, up, status: 200, latency_ms: 5 });
    ping("up.a", 50, 0); // before the window
    ping("up.a", 100, 1);
    ping("up.a", 200, 0);
    ping("up.a", 300, 1);
    ping("up.b", 150, 0);
    const day = uptimeSince(100);
    expect(day.get("up.a")).toEqual({ checks: 3, up: 2 });
    expect(day.get("up.b")).toEqual({ checks: 1, up: 0 });
    expect(day.get("up.none")).toBeUndefined();
  });

  it("leaves failures during maintenance out of uptime, but not passes", async () => {
    const { insertPing, uptimeSince } = await import("@/lib/db");
    const ping = (ts: number, up: number, maint: number) => insertPing({ service_id: "up.maint", ts, up, status: 200, latency_ms: 5, maint });
    ping(1000, 1, 0);
    ping(1100, 0, 1); // down in maintenance: not counted
    ping(1200, 1, 1); // up in maintenance: counted
    ping(1300, 0, 0); // down outside it: counted
    expect(uptimeSince(1000).get("up.maint")).toEqual({ checks: 3, up: 2 });
    expect(rollupHour([{ ts: 0, up: 0, latency_ms: null, maint: 1 }, { ts: 1, up: 1, latency_ms: 10 }])).toMatchObject({ checks: 1, up: 1 });
  });
});

describe("maintenance", () => {
  // Local time, like the settings: 2026-10-11 is a Sunday.
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);

  it("matches windows by time and by the day they start on", async () => {
    const { inWindow } = await import("@/lib/maintenance");
    const night = { from: "03:00", to: "05:00" };
    expect(inWindow(night, at(12, 3))).toBe(true);
    expect(inWindow(night, at(12, 4, 59))).toBe(true);
    expect(inWindow(night, at(12, 5))).toBe(false);
    expect(inWindow(night, at(12, 2, 59))).toBe(false);
    expect(inWindow({ ...night, days: ["sun" as const] }, at(11, 4))).toBe(true);
    expect(inWindow({ ...night, days: ["sun" as const] }, at(12, 4))).toBe(false);

    // Past midnight: Saturday's window covers the first hours of Sunday, Sunday evening is not in it.
    const late = { from: "23:00", to: "02:00", days: ["sat" as const] };
    expect(inWindow(late, at(10, 23, 30))).toBe(true);
    expect(inWindow(late, at(11, 1, 30))).toBe(true);
    expect(inWindow(late, at(11, 2))).toBe(false);
    expect(inWindow(late, at(11, 23, 30))).toBe(false);
    expect(inWindow({ from: "00:00", to: "00:00" }, at(13, 15))).toBe(true);
  });

  it("applies windows and one-off mutes to the right services", async () => {
    const { ALL, listMutes, maintenanceNow, mute, mutedNow, unmute } = await import("@/lib/maintenance");
    const windows = [{ name: "Backups", from: "03:00", to: "05:00", services: ["infra.nas"] }];
    expect(maintenanceNow(windows, [], "infra.nas", at(12, 4))).toEqual({ window: "Backups" });
    expect(maintenanceNow(windows, [], "infra.router", at(12, 4))).toBeUndefined();
    expect(maintenanceNow(windows, [], "infra.nas", at(12, 6))).toBeUndefined();

    const now = at(12, 12).getTime();
    mute("infra.router", 30, "root", now);
    expect(mutedNow(listMutes(now), "infra.router", new Date(now))).toEqual({ until: now + 30 * 60_000 });
    expect(mutedNow(listMutes(now), "infra.nas", new Date(now))).toBeUndefined();
    // It runs out on its own.
    expect(listMutes(now + 31 * 60_000)).toEqual({});
    mute(ALL, null, "root", now);
    expect(mutedNow(listMutes(now), "anything", new Date(now + 86_400_000 * 30))).toEqual({ all: true });
    unmute(ALL, now);
    unmute("infra.router", now);
    expect(listMutes(now)).toEqual({});
  });

  it("holds back alerts while muted, and sends DOWN afterwards if still down", async () => {
    const { alertDecision, evaluate } = await import("@/lib/alerts");
    type S = Parameters<typeof evaluate>[0];
    const sent: string[] = [];
    let state: S = { failures: 0, down: false };
    const check = (up: boolean, muted: boolean, now: number) => {
      const e = evaluate(state, up, 2, now);
      const d = alertDecision(state, e.state, e.event, muted);
      state = d.state;
      if (d.send) sent.push(d.send);
    };
    // Goes down during the window: nothing sent, also not for the recovery inside it.
    check(false, true, 1);
    check(false, true, 2);
    expect(state).toMatchObject({ down: true, suppressed: true });
    check(true, true, 3);
    expect(sent).toEqual([]);
    // Down again in the window, still down when it ends: DOWN then, UP on recovery.
    check(false, true, 4);
    check(false, true, 5);
    check(false, false, 6);
    expect(sent).toEqual(["down"]);
    check(false, false, 7);
    check(true, false, 8);
    expect(sent).toEqual(["down", "up"]);
    // Outside a window nothing changes: DOWN after the threshold, UP after.
    check(false, false, 9);
    check(false, false, 10);
    check(true, false, 11);
    expect(sent).toEqual(["down", "up", "down", "up"]);
  });

  it("records an outage that starts in maintenance as planned", async () => {
    const { incidentsSince, openIncident } = await import("@/lib/db");
    openIncident("infra.planned", 2000, "no response", true);
    openIncident("infra.unplanned", 2000, "no response");
    expect(incidentsSince("infra.planned", 0)[0].planned).toBe(1);
    expect(incidentsSince("infra.unplanned", 0)[0].planned).toBe(0);
  });
});
