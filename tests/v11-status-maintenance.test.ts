import { describe, expect, it } from "vitest";
import { db, hourlyChecksSince, incidentsOverlapping, insertPing, openIncident, upsertHour } from "@/lib/db";
import { servicesFileSchema, settingsSchema } from "@/lib/config/schema";
import { dailyUptime, lastDays, pickServices } from "@/lib/statusPage";

const HOUR = 3_600_000;

describe("public status page", () => {
  const groups = servicesFileSchema.parse([
    {
      name: "Infra",
      services: [
        { name: "NAS", href: "http://nas.local", ping: true },
        { name: "Wiki", href: "http://wiki.local" }, // no check
        { name: "Vault", href: "http://vault.local", ping: true, visible: "admins" },
      ],
    },
    { name: "Family", visible: "users", services: [{ name: "Photos", href: "http://photos.local", ping: true }] },
  ]);

  it("is off by default", () => {
    expect(settingsSchema.parse({}).statusPage).toEqual({ enabled: false, days: 90 });
  });

  it("shows only checked services anyone may see, unless ids are listed", () => {
    expect(pickServices(groups)).toEqual([{ id: "infra.nas", name: "NAS", group: "Infra" }]);
    // Listing a hidden service puts it on the page on purpose; one without a check never appears.
    expect(pickServices(groups, ["infra.vault", "infra.wiki", "family.photos"]).map((s) => s.id)).toEqual(["infra.vault", "family.photos"]);
  });

  it("turns hourly counts into one uptime per calendar day", () => {
    const now = new Date(2026, 9, 12, 15);
    const days = lastDays(3, now);
    expect(days).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
    const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
    const r = dailyUptime(
      [
        { hour: at(10, 1), checks: 100, up: 100 },
        { hour: at(10, 2), checks: 100, up: 50 },
        { hour: at(12, 9), checks: 10, up: 10 },
        { hour: at(9, 23), checks: 50, up: 0 }, // before the period
      ],
      days,
    );
    expect(r.days).toEqual([
      { day: "2026-10-10", uptime: 0.75 },
      { day: "2026-10-11", uptime: null },
      { day: "2026-10-12", uptime: 1 },
    ]);
    expect(r.uptime).toBeCloseTo(160 / 210);
  });

  it("reads finished hours from the rollups and recent ones from raw checks, without counting twice", () => {
    db().exec("DELETE FROM pings; DELETE FROM pings_hourly;");
    const h = 500_000 * HOUR;
    upsertHour({ service_id: "s.a", hour: h, checks: 120, up: 120, avg_ms: 5, p95_ms: 9 });
    // An hour that is in both: only the rollup counts before rawFrom, only raw checks from it on.
    upsertHour({ service_id: "s.a", hour: h + HOUR, checks: 120, up: 60, avg_ms: 5, p95_ms: 9 });
    insertPing({ service_id: "s.a", ts: h + HOUR + 1000, up: 1, status: 200, latency_ms: 5 });
    insertPing({ service_id: "s.a", ts: h + 2 * HOUR + 1000, up: 0, status: 500, latency_ms: null });
    insertPing({ service_id: "s.a", ts: h + 2 * HOUR + 2000, up: 1, status: 200, latency_ms: 5 });
    const rows = hourlyChecksSince(h, h + 2 * HOUR).get("s.a")!;
    expect(rows.sort((a, b) => a.hour - b.hour)).toEqual([
      { hour: h, checks: 120, up: 120 },
      { hour: h + HOUR, checks: 120, up: 60 },
      { hour: h + 2 * HOUR, checks: 2, up: 1 },
    ]);
  });

  it("lists outages that were still open at a time or began after it", () => {
    db().exec("DELETE FROM incidents;");
    db().prepare("INSERT INTO incidents (service_id, start, end, cause) VALUES (?, ?, ?, ?)").run("s.old", 100, 200, "x");
    db().prepare("INSERT INTO incidents (service_id, start, end, cause) VALUES (?, ?, ?, ?)").run("s.recent", 900, 1100, "x");
    openIncident("s.now", 1500, "x", true);
    expect(incidentsOverlapping(1000).map((i) => [i.service_id, i.planned])).toEqual([
      ["s.now", 1],
      ["s.recent", 0],
    ]);
  });
});

describe("maintenance API", () => {
  it("is for admins only", async () => {
    const { DELETE, GET, POST } = await import("@/app/api/maintenance/route");
    const req = (method: string) => new Request("http://localhost/api/maintenance?service=*", { method, body: method === "POST" ? JSON.stringify({ service: "*", minutes: 30 }) : undefined });
    expect((await GET()).status).toBe(403);
    expect((await POST(req("POST"))).status).toBe(403);
    expect((await DELETE(req("DELETE"))).status).toBe(403);
    const { listMutes } = await import("@/lib/maintenance");
    expect(listMutes()).toEqual({});
  });

  it("accepts windows in settings and refuses bad times", () => {
    const ok = settingsSchema.parse({ maintenance: [{ name: "Backups", days: ["sun"], from: "03:00", to: "05:00", services: ["infra.nas"] }] });
    expect(ok.maintenance).toHaveLength(1);
    expect(settingsSchema.parse({}).maintenance).toEqual([]);
    expect(() => settingsSchema.parse({ maintenance: [{ from: "3am", to: "05:00" }] })).toThrow();
    expect(() => settingsSchema.parse({ maintenance: [{ from: "03:00", to: "05:00", days: ["sunday"] }] })).toThrow();
  });
});
