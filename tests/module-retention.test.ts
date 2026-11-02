import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR, db, getAppMeta } from "@/lib/db";
import { CONFIG_DIR, loadConfig } from "@/lib/config/load";
import { writeConfig } from "@/lib/config/write";
import { backupPath, isModuleArchiveName, listBackups, prune } from "@/lib/backup";
import { hasData, MODULE_TABLES, whenEnabled } from "@/lib/modules";
import { moduleStatus, reconcileModules } from "@/lib/module-retention";

const dir = path.join(DATA_DIR, "backups");
const DAY = 86_400_000;
const t0 = new Date(2026, 10, 2, 12, 0);

const setApps = (apps: string[], retention?: number) => {
  const ok = writeConfig("settings", { title: "Mods", apps, backup: retention ? { moduleRetentionDays: retention } : undefined });
  expect(ok).toEqual({ ok: true });
};

const noteCount = () => (db().prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n;

beforeEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  for (const app of Object.keys(MODULE_TABLES) as (keyof typeof MODULE_TABLES)[]) for (const t of MODULE_TABLES[app]) db().exec(`DELETE FROM ${t}`);
  db().exec("DELETE FROM app_meta WHERE key = 'modules.off'");
  db().exec("INSERT INTO notes (title, body, created_at, updated_at) VALUES ('Restart the NAS', 'Hold the button', 1, 1)");
  db().exec("INSERT INTO note_services (note_id, service_id) SELECT id, 'infra.nas' FROM notes");
  setApps(["notes", "inventory"]);
});

describe("turned-off apps", () => {
  it("lists every table of every app, and finds data", () => {
    expect(hasData("notes")).toBe(true);
    expect(hasData("travel")).toBe(false);
  });

  it("archives an app with data when it is turned off and keeps the rows", () => {
    setApps(["inventory"]);
    reconcileModules(t0);
    const [status] = moduleStatus();
    expect(status).toMatchObject({ app: "notes", since: t0.toISOString(), wipeAt: new Date(t0.getTime() + 30 * DAY).toISOString() });
    expect(isModuleArchiveName(status.archive)).toBe(true);
    expect(backupPath(status.archive)).toBeDefined();
    expect(status.size).toBeGreaterThan(0);
    expect(noteCount()).toBe(1);
    // Running again changes nothing.
    reconcileModules(new Date(t0.getTime() + DAY));
    expect(moduleStatus()).toEqual([status]);
    expect(fs.readdirSync(dir)).toEqual([status.archive]);
  });

  it("records nothing for an app turned off with no data", () => {
    setApps(["notes"]);
    reconcileModules(t0);
    expect(moduleStatus()).toEqual([]);
    expect(getAppMeta("modules.off")).toBeUndefined();
  });

  it("forgets the countdown and the archive when the app is turned back on", () => {
    setApps([]);
    reconcileModules(t0);
    const { archive } = moduleStatus()[0];
    setApps(["notes"]);
    reconcileModules(new Date(t0.getTime() + 29 * DAY));
    expect(moduleStatus()).toEqual([]);
    expect(fs.existsSync(path.join(dir, archive))).toBe(false);
    expect(noteCount()).toBe(1);
  });

  it("deletes the rows and the archive once the retention is over", () => {
    setApps([], 7);
    reconcileModules(t0);
    const { archive } = moduleStatus()[0];
    reconcileModules(new Date(t0.getTime() + 6 * DAY));
    expect(noteCount()).toBe(1);
    reconcileModules(new Date(t0.getTime() + 7 * DAY));
    expect(noteCount()).toBe(0);
    expect(hasData("notes")).toBe(false);
    expect(fs.existsSync(path.join(dir, archive))).toBe(false);
    expect(moduleStatus()).toEqual([]);
    expect(db().prepare("SELECT action FROM audit WHERE action = 'module-wipe'").get()).toEqual({ action: "module-wipe" });
  });

  it("is never removed by the nightly backup pruning", () => {
    setApps([]);
    reconcileModules(t0);
    const { archive } = moduleStatus()[0];
    prune(dir, 1, 1, t0.getTime() + 400 * DAY);
    expect(listBackups(dir)).toEqual([]);
    expect(fs.existsSync(path.join(dir, archive))).toBe(true);
  });

  it("puts an app's jobs to sleep while it is off", async () => {
    const job = vi.fn(async () => {});
    setApps(["notes"]);
    await whenEnabled("finance", job)();
    expect(job).not.toHaveBeenCalled();
    setApps(["finance"]);
    await whenEnabled("finance", job)();
    expect(job).toHaveBeenCalledOnce();
  });
});

describe("first-run setup", () => {
  it("turns on the apps picked during setup", async () => {
    const { POST } = await import("@/app/api/auth/setup/route");
    db().exec("DELETE FROM users;");
    const post = (body: unknown) => POST(new Request("http://localhost/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    expect((await post({ username: "admin", password: "long enough", apps: ["finance", "nope"] })).status).toBe(400);
    expect((await post({ username: "admin", password: "long enough", apps: ["finance", "travel"] })).status).toBe(200);
    expect(loadConfig().settings.apps).toEqual(["finance", "travel"]);
  });
});
