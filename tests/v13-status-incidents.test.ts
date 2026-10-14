import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addUpdate, createIncident, deleteUpdate, editIncident, getIncident, listIncidents } from "@/lib/statusIncidents";
import { nextWindowStart } from "@/lib/maintenance";

beforeEach(() => db().exec("DELETE FROM status_incidents;"));

describe("posted incidents", () => {
  it("go from investigating to resolved, with a timeline", () => {
    const i = createIncident({ title: " Photos are slow ", impact: "major", services: ["media.immich", "media.immich", "nope!"], body: "Looking into it" }, "root", 1000);
    expect(i).toMatchObject({ title: "Photos are slow", status: "investigating", impact: "major", services: ["media.immich"], resolved_at: null, created_by: "root" });
    expect(i.updates).toEqual([{ id: expect.any(Number), status: "investigating", body: "Looking into it", at: 1000, by: "root" }]);

    addUpdate(i.id, { status: "identified", body: "A disk is failing" }, "root", 2000);
    const done = addUpdate(i.id, { status: "resolved", body: "Disk replaced" }, "root", 3000);
    expect(done).toMatchObject({ status: "resolved", resolved_at: 3000 });
    expect(done.updates.map((u) => u.status)).toEqual(["resolved", "identified", "investigating"]);

    // Reopening clears the end; deleting the last update goes back to the one before.
    expect(addUpdate(i.id, { status: "monitoring", body: "Slow again" }, "root", 4000).resolved_at).toBeNull();
    const latest = getIncident(i.id)!.updates[0];
    expect(deleteUpdate(i.id, latest.id)).toMatchObject({ status: "resolved", resolved_at: 3000 });

    expect(() => addUpdate(i.id, { status: "resolved" }, "root")).toThrow(/Write what changed/);
    expect(() => addUpdate(i.id, { status: "fixed", body: "x" }, "root")).toThrow(/Status must be/);
    expect(editIncident(i.id, { title: "Photos were slow", impact: "minor" })).toMatchObject({ title: "Photos were slow", impact: "minor" });
  });

  it("list open ones first, then recently resolved ones", () => {
    const old = createIncident({ title: "Old", status: "resolved", body: "x" }, null, 1000);
    const recent = createIncident({ title: "Recent", status: "resolved", body: "x" }, null, 50_000);
    const open = createIncident({ title: "Open", body: "x" }, null, 10_000);
    expect(listIncidents(20_000).map((i) => i.id)).toEqual([open.id, recent.id]);
    expect(listIncidents(0).map((i) => i.id)).toEqual([open.id, recent.id, old.id]);
    expect(() => createIncident({ title: "" }, null)).toThrow(/Title required/);
  });
});

describe("upcoming maintenance windows", () => {
  // 2026-10-14 is a Wednesday.
  const now = new Date(2026, 9, 14, 12, 0);

  it("finds the next start and end, on the right days", () => {
    expect(nextWindowStart({ from: "03:00", to: "05:00" }, now)).toEqual({ start: new Date(2026, 9, 15, 3, 0).getTime(), end: new Date(2026, 9, 15, 5, 0).getTime() });
    expect(nextWindowStart({ from: "18:00", to: "19:00" }, now)?.start).toBe(new Date(2026, 9, 14, 18, 0).getTime());
    expect(nextWindowStart({ days: ["sun"], from: "23:00", to: "02:00" }, now)).toEqual({ start: new Date(2026, 9, 18, 23, 0).getTime(), end: new Date(2026, 9, 19, 2, 0).getTime() });
    // Out of range.
    expect(nextWindowStart({ days: ["mon"], from: "03:00", to: "04:00" }, now, 3)).toBeUndefined();
  });
});
