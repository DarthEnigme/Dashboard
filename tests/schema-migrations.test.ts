import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_DIR, SCHEMA_VERSION, SNAPSHOT_DIR, db, snapshotDb } from "@/lib/db";

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

afterEach(reset);

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
    const snapshot = snapshotDb("pre-update-0.5.11-to-0.6.0");
    g.__pageDb!.close();
    g.__pageDb = undefined;
    // What the newer version left behind: a newer schema, and the pending record pointing at the snapshot.
    const d = new DatabaseSync(FILE);
    d.exec(`
      INSERT INTO users (username, created_at) VALUES ('after-update', 2);
      INSERT OR REPLACE INTO app_meta (key, value) VALUES ('update.pending', '${JSON.stringify({ from: "0.5.11", to: "0.6.0", snapshot }).replace(/'/g, "''")}');
      PRAGMA user_version = ${SCHEMA_VERSION + 1};
    `);
    d.close();

    expect(version()).toBe(SCHEMA_VERSION);
    expect((db().prepare("SELECT username FROM users ORDER BY id").all() as { username: string }[]).map((u) => u.username)).toEqual(["before-update"]);
    // The upgraded database is kept, not deleted.
    const kept = fs.readdirSync(DATA_DIR).filter((f) => new RegExp(`^page\\.db\\.schema-v${SCHEMA_VERSION + 1}-\\d+$`).test(f));
    expect(kept).toHaveLength(1);
  });

  it("keeps only the newest snapshots", () => {
    reset();
    for (let i = 0; i < 8; i++) {
      const f = snapshotDb(`test-${i}`);
      fs.utimesSync(f, new Date(1000 * (i + 1)), new Date(1000 * (i + 1)));
    }
    const left = fs.readdirSync(SNAPSHOT_DIR).sort();
    expect(left).toHaveLength(5);
    expect(left.some((f) => f.startsWith("test-7-"))).toBe(true);
    expect(left.some((f) => f.startsWith("test-0-"))).toBe(false);
  });
});
