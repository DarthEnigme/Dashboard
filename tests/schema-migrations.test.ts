import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR, SCHEMA_VERSION, db, getAppMeta, setAppMeta } from "@/lib/db";
import { SNAPSHOT_DIR, finishRestore, listSnapshots, restoreSnapshot, snapshotDb, snapshotPath } from "@/lib/snapshots";
import { bootId, reconcilePendingUpdate, updateHistory } from "@/lib/update/apply";
import { readJournal, writeJournal, type Journal } from "@/lib/update/journal";
import { buildInfo } from "@/lib/version";

const g = globalThis as typeof globalThis & { __pageDb?: DatabaseSync };
const FILE = path.join(DATA_DIR, "page.db");

/** Close the shared handle and remove every database file, so the next db() opens from scratch. */
function reset() {
  g.__pageDb?.close();
  g.__pageDb = undefined;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** A database as 0.5.8 left it: no user_version, and columns added in later releases missing. */
function legacyDb(file = FILE) {
  const d = new DatabaseSync(file);
  d.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT COLLATE NOCASE,
      name TEXT, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE fin_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, category TEXT,
      description TEXT NOT NULL DEFAULT '', account TEXT, source TEXT NOT NULL DEFAULT 'manual', external_id TEXT UNIQUE, created_at INTEGER NOT NULL
    );
    CREATE TABLE fin_recurring (
      id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, category TEXT,
      every TEXT NOT NULL, every_n INTEGER NOT NULL DEFAULT 1, start_date TEXT NOT NULL, end_date TEXT, last_date TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
    );
    INSERT INTO users (username, role, created_at) VALUES ('admin', 'admin', 1);
    INSERT INTO fin_transactions (date, amount_cents, currency, description, created_at) VALUES ('2026-10-01', -4210, 'EUR', 'Groceries', 1);
    INSERT INTO fin_recurring (description, amount_cents, currency, every, start_date, created_at) VALUES ('VPS', -500, 'EUR', 'month', '2026-01-01', 1);
  `);
  d.close();
}

const columns = (table: string) => (db().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const version = () => (db().prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

afterEach(() => {
  vi.restoreAllMocks();
  reset();
});

/** The update record the old version leaves before the handover. */
const journal = (over: Partial<Journal> = {}): Journal => ({ from: "0.6.0", fromBuild: buildInfo().buildId, to: "0.6.1", image: "img:0.6.1", user: "admin", startedAt: 1, bootId: "the-old-process", ...over });

/** The newer version's leftovers: one more user, a newer schema, and (0.6.0 style) the record in app_meta. */
function upgradedByNewerVersion(legacyPending?: Journal) {
  g.__pageDb!.close();
  g.__pageDb = undefined;
  const d = new DatabaseSync(FILE);
  d.exec(`INSERT INTO users (username, created_at) VALUES ('after-update', 2); PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
  if (legacyPending) d.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('update.pending', ?)").run(JSON.stringify(legacyPending));
  d.close();
}

const usernames = () => (db().prepare("SELECT username FROM users ORDER BY id").all() as { username: string }[]).map((u) => u.username);

describe("schema migrations", () => {
  it("creates a fresh database at the current schema, without a snapshot", () => {
    reset();
    expect(version()).toBe(SCHEMA_VERSION);
    expect(columns("fin_recurring")).toContain("subscription");
    expect(fs.existsSync(SNAPSHOT_DIR)).toBe(false);
  });

  it("upgrades a pre-versioning database in place and keeps its data", () => {
    reset();
    legacyDb();
    expect(version()).toBe(SCHEMA_VERSION);
    expect(columns("fin_transactions")).toContain("transfer_id");
    expect(columns("fin_recurring")).toEqual(expect.arrayContaining(["subscription", "url", "cancel_by"]));
    expect(columns("users")).toContain("totp_secret");
    expect(db().prepare("SELECT username FROM users").all()).toEqual([{ username: "admin" }]);
    expect(db().prepare("SELECT amount_cents, description FROM fin_transactions").get()).toEqual({ amount_cents: -4210, description: "Groceries" });
    expect(db().prepare("SELECT subscription FROM fin_recurring").get()).toEqual({ subscription: 0 });
  });

  it("takes a snapshot of the old database before migrating it", () => {
    reset();
    legacyDb();
    db();
    const snaps = fs.readdirSync(SNAPSHOT_DIR);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatch(new RegExp(`^pre-migrate-v0-v${SCHEMA_VERSION}-.*\\.db$`));
    // The snapshot is the database as it was: old schema, same data.
    const snap = new DatabaseSync(path.join(SNAPSHOT_DIR, snaps[0]));
    expect((snap.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(0);
    expect((snap.prepare("PRAGMA table_info(fin_transactions)").all() as { name: string }[]).map((c) => c.name)).not.toContain("transfer_id");
    expect(snap.prepare("SELECT description FROM fin_transactions").get()).toEqual({ description: "Groceries" });
    snap.close();
  });

  it("doesn't migrate or snapshot again on the next start", () => {
    reset();
    legacyDb();
    db();
    g.__pageDb!.close();
    g.__pageDb = undefined;
    expect(version()).toBe(SCHEMA_VERSION);
    expect(fs.readdirSync(SNAPSHOT_DIR)).toHaveLength(1);
  });

  it("refuses to start on a database a newer NanoDash upgraded", () => {
    reset();
    const d = new DatabaseSync(FILE);
    d.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY); PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
    d.close();
    expect(() => db()).toThrow(/only knows up to/);
    // Untouched: still the newer file, nothing moved aside.
    expect(fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("page.db.schema"))).toEqual([]);
  });

  it("puts back the pre-update snapshot when an update was rolled back", () => {
    reset();
    // What the old version had just before the handover, copied as its snapshot.
    db().prepare("INSERT INTO users (username, created_at) VALUES ('before-update', 1)").run();
    const snapshot = snapshotDb("pre-update-0.6.0-to-0.6.1", db());
    writeJournal(journal({ snapshot }));
    upgradedByNewerVersion();

    expect(version()).toBe(SCHEMA_VERSION);
    expect(usernames()).toEqual(["before-update"]);
    // The upgraded database is kept, not deleted.
    const kept = fs.readdirSync(DATA_DIR).filter((f) => new RegExp(`^page\\.db\\.schema-v${SCHEMA_VERSION + 1}-\\d+$`).test(f));
    expect(kept).toHaveLength(1);
    // Left in the journal for reconcilePendingUpdate, so the rollback says the database was put back.
    expect(readJournal()?.restored).toEqual({ snapshot, kept: path.join(DATA_DIR, kept[0]), at: expect.any(String) });
  });

  it("still finds the snapshot of an update 0.6.0 started (record in app_meta)", () => {
    reset();
    db().prepare("INSERT INTO users (username, created_at) VALUES ('before-update', 1)").run();
    const snapshot = snapshotDb("pre-update-0.6.0-to-0.6.1", db());
    upgradedByNewerVersion(journal({ snapshot }));
    expect(usernames()).toEqual(["before-update"]);
  });

  it("keeps the record while the new version could still be rolled back", () => {
    reset();
    writeJournal(journal({ fromBuild: "an-older-build" }));
    vi.spyOn(process, "uptime").mockReturnValue(30);
    expect(reconcilePendingUpdate()).toBeUndefined();
    expect(updateHistory()).toEqual([]);
    expect(readJournal()).toBeDefined();
  });

  it("records the update once the new version has outlived the helper's health wait", () => {
    reset();
    writeJournal(journal({ fromBuild: "an-older-build" }));
    setAppMeta("update.pending", journal({ fromBuild: "an-older-build" }));
    vi.spyOn(process, "uptime").mockReturnValue(10 * 60);
    expect(reconcilePendingUpdate()?.entry).toMatchObject({ from: "0.6.0", result: "updated" });
    expect(readJournal()).toBeUndefined();
    expect(getAppMeta("update.pending")).toBeUndefined();
  });

  it("leaves an update alone in the process that handed it over", () => {
    reset();
    writeJournal(journal({ bootId: bootId() }));
    expect(reconcilePendingUpdate()).toBeUndefined();
    expect(readJournal()).toBeDefined();
  });

  it("records a rollback that restored the database in the update history", () => {
    reset();
    // The old build again, in a later process, with the database put back.
    writeJournal(journal({ restored: { snapshot: "/data/snapshots/pre-update.db", kept: "/data/page.db.schema-v2-1", at: "2026-10-19T00:00:00Z" } }));
    const outcome = reconcilePendingUpdate();
    const [entry] = updateHistory();
    expect(entry).toMatchObject({ from: "0.6.0", to: "0.6.1", result: "rolled back" });
    // A path the user can find from the host, not the container's.
    expect(entry.detail).toContain("only in data/page.db.schema-v2-1.");
    expect(outcome).toEqual({ entry, restored: expect.objectContaining({ kept: "/data/page.db.schema-v2-1" }) });
    expect(readJournal()).toBeUndefined();
  });

  it("never prunes the snapshot an update in progress points to", () => {
    reset();
    const pinned = snapshotDb("pre-update", db());
    fs.utimesSync(pinned, new Date(1000), new Date(1000));
    writeJournal(journal({ snapshot: pinned }));
    for (let i = 0; i < 8; i++) snapshotDb(`pre-migrate-${i}`, db());
    expect(fs.existsSync(pinned)).toBe(true);
    expect(listSnapshots()).toHaveLength(6);
  });

  it("lists snapshots newest first and only hands out files inside the snapshot folder", () => {
    reset();
    const a = snapshotDb("pre-migrate-v0-v1", db());
    fs.utimesSync(a, new Date(1000), new Date(1000));
    const b = snapshotDb("pre-update-0.6.0-to-0.6.1", db());
    expect(listSnapshots().map((s) => s.name)).toEqual([path.basename(b), path.basename(a)]);
    expect(snapshotPath(path.basename(b))).toBe(b);
    for (const bad of ["../page.db", "..\\page.db", "sub/x.db", "page-backup.zip", ".hidden.db", "missing.db"]) expect(snapshotPath(bad)).toBeUndefined();
  });

  it("never lists a snapshot that is still being written", () => {
    reset();
    db();
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SNAPSHOT_DIR, "pre-update-0.6.0-to-0.6.1-x.db.tmp"), "half");
    const done = snapshotDb("pre-migrate-v0-v1", db());
    expect(listSnapshots().map((s) => s.name)).toEqual([path.basename(done)]);
    expect(snapshotPath("pre-update-0.6.0-to-0.6.1-x.db.tmp")).toBeUndefined();
  });

  it("finishes a restore that stopped after the old database was moved aside", () => {
    reset();
    db().prepare("INSERT INTO users (username, created_at) VALUES ('from-snapshot', 1)").run();
    const snapshot = snapshotDb("pre-update", db());
    g.__pageDb!.close();
    g.__pageDb = undefined;
    // The power went out between the two renames: the copy is in place as .restoring, page.db is gone.
    fs.renameSync(FILE, `${FILE}.schema-v9-1`);
    fs.copyFileSync(snapshot, `${FILE}.restoring`);
    expect((db().prepare("SELECT username FROM users").all() as { username: string }[]).map((u) => u.username)).toEqual(["from-snapshot"]);
    expect(fs.existsSync(`${FILE}.restoring`)).toBe(false);
  });

  it("drops a leftover restore copy when the database is still there", () => {
    reset();
    db().prepare("INSERT INTO users (username, created_at) VALUES ('live', 1)").run();
    g.__pageDb!.close();
    g.__pageDb = undefined;
    fs.writeFileSync(`${FILE}.restoring`, "stale");
    finishRestore(FILE);
    expect(fs.existsSync(`${FILE}.restoring`)).toBe(false);
    expect((db().prepare("SELECT username FROM users").all() as { username: string }[]).map((u) => u.username)).toEqual(["live"]);
  });

  it("refuses to restore a damaged snapshot and leaves the database alone", () => {
    reset();
    db().prepare("INSERT INTO users (username, created_at) VALUES ('live', 1)").run();
    const snapshot = snapshotDb("pre-update", db());
    g.__pageDb!.close();
    g.__pageDb = undefined;
    fs.truncateSync(snapshot, 100);
    expect(() => restoreSnapshot(snapshot, FILE, `${FILE}.kept`)).toThrow(/damaged/);
    expect(fs.existsSync(`${FILE}.kept`)).toBe(false);
    expect(fs.existsSync(`${FILE}.restoring`)).toBe(false);
    expect((db().prepare("SELECT username FROM users").all() as { username: string }[]).map((u) => u.username)).toEqual(["live"]);
  });

  it("keeps only the newest snapshots", () => {
    reset();
    for (let i = 0; i < 8; i++) {
      const f = snapshotDb(`test-${i}`, db());
      fs.utimesSync(f, new Date(1000 * (i + 1)), new Date(1000 * (i + 1)));
    }
    const left = fs.readdirSync(SNAPSHOT_DIR).sort();
    expect(left).toHaveLength(5);
    expect(left.some((f) => f.startsWith("test-7-"))).toBe(true);
    expect(left.some((f) => f.startsWith("test-0-"))).toBe(false);
  });
});
