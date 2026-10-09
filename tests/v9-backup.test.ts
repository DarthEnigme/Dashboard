import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR, db, getAppMeta, setAppMeta } from "@/lib/db";
import { CONFIG_DIR } from "@/lib/config/load";
import { backupJob, backupPath, createBackup, isBackupName, listBackups, prune } from "@/lib/backup";

/** Entries of a stored (uncompressed) zip, as written by lib/zip.ts. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString();
    const start = i + 30 + nameLen + extra;
    out.set(name, buf.subarray(start, start + size));
    i = start + size;
  }
  return out;
}

const dir = path.join(DATA_DIR, "backups");

beforeEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_DIR, "settings.yaml"), "title: Backed up # keep me\n");
  fs.mkdirSync(path.join(DATA_DIR, "uploads", "backgrounds"), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "uploads", "backgrounds", "sky.png"), Buffer.from([1, 2, 3]));
  db().exec("CREATE TABLE IF NOT EXISTS backup_probe (v TEXT); DELETE FROM backup_probe; INSERT INTO backup_probe VALUES ('hello');");
});

describe("backups", () => {
  it("zips the config, a working copy of the database, uploads and the secret key", () => {
    const b = createBackup("test", new Date(2026, 9, 9, 3, 0));
    expect(b.name).toBe("page-backup-2026-10-09-0300.zip");
    const files = unzip(fs.readFileSync(path.join(dir, b.name)));
    expect(files.get("config/settings.yaml")?.toString()).toBe("title: Backed up # keep me\n");
    expect(files.get("data/uploads/backgrounds/sky.png")).toEqual(Buffer.from([1, 2, 3]));
    expect(files.has("README.txt")).toBe(true);

    const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "page-restore-")), "page.db");
    fs.writeFileSync(copy, files.get("data/page.db")!);
    const restored = new DatabaseSync(copy);
    expect(restored.prepare("SELECT v FROM backup_probe").get()).toEqual({ v: "hello" });
    restored.close();
    // No snapshot or partial file is left behind.
    expect(fs.readdirSync(dir)).toEqual([b.name]);
  });

  it("never overwrites a backup taken in the same minute", () => {
    const at = new Date(2026, 9, 9, 3, 0);
    createBackup("test", at);
    expect(createBackup("test", at).name).toBe("page-backup-2026-10-09-0300-2.zip");
  });

  it("keeps only the newest backups", () => {
    for (let d = 1; d <= 4; d++) {
      const b = createBackup("test", new Date(2026, 9, d, 3, 0));
      fs.utimesSync(path.join(dir, b.name), new Date(2026, 9, d), new Date(2026, 9, d));
    }
    prune(dir, 2);
    expect(listBackups(dir).map((b) => b.name)).toEqual(["page-backup-2026-10-04-0300.zip", "page-backup-2026-10-03-0300.zip"]);
  });

  it("only serves files that are backups", () => {
    const b = createBackup("test");
    expect(backupPath(b.name)).toBe(path.join(dir, b.name));
    expect(isBackupName("../page.db")).toBe(false);
    expect(backupPath("../secret.key")).toBeUndefined();
    expect(backupPath("page-backup-2020-01-01-0000.zip")).toBeUndefined();
  });

  it("runs once a day, in the configured hour", async () => {
    setAppMeta("backup.day", undefined);
    await backupJob(new Date(2026, 9, 9, 2, 0));
    expect(listBackups(dir)).toHaveLength(0);
    await backupJob(new Date(2026, 9, 9, 3, 5));
    await backupJob(new Date(2026, 9, 9, 3, 50));
    expect(listBackups(dir)).toHaveLength(1);
    expect(getAppMeta<{ ok: boolean; by: string }>("backup.last")).toMatchObject({ ok: true, by: "nightly" });
    await backupJob(new Date(2026, 9, 10, 3, 0));
    expect(listBackups(dir)).toHaveLength(2);
  });
});
