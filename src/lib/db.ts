import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DATA_DIR = process.env.HOMEPAGE_DATA_DIR ?? path.join(process.cwd(), "data");

export interface PingRow {
  service_id: string;
  ts: number;
  up: number;
  status: number | null;
  latency_ms: number | null;
}

// One handle per process: route handlers and the monitor may load this module separately.
const g = globalThis as typeof globalThis & { __pageDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__pageDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const d = new DatabaseSync(path.join(DATA_DIR, "page.db"));
    d.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pings (
        service_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        up INTEGER NOT NULL,
        status INTEGER,
        latency_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS pings_service_ts ON pings (service_id, ts);

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT COLLATE NOCASE,
        name TEXT,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS identities (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        PRIMARY KEY (provider, subject)
      );
      CREATE TABLE IF NOT EXISTS pings_hourly (
        service_id TEXT NOT NULL,
        hour INTEGER NOT NULL,
        checks INTEGER NOT NULL,
        up INTEGER NOT NULL,
        avg_ms REAL,
        p95_ms REAL,
        PRIMARY KEY (service_id, hour)
      );
      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        start INTEGER NOT NULL,
        end INTEGER,
        cause TEXT
      );
      CREATE INDEX IF NOT EXISTS incidents_service ON incidents (service_id, start);
      CREATE TABLE IF NOT EXISTS fin_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        category TEXT,
        description TEXT NOT NULL DEFAULT '',
        account TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        external_id TEXT UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS fin_transactions_date ON fin_transactions (date);
      CREATE TABLE IF NOT EXISTS fin_categories (
        name TEXT PRIMARY KEY COLLATE NOCASE,
        slot INTEGER
      );
      CREATE TABLE IF NOT EXISTS fin_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS config_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file TEXT NOT NULL,
        ts INTEGER NOT NULL,
        user TEXT,
        content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS config_versions_file ON config_versions (file, id);
      CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        ts INTEGER NOT NULL,
        user TEXT,
        action TEXT NOT NULL,
        detail TEXT
      );
    `);
    addColumn(d, "fin_categories", "budget_cents INTEGER");
    addColumn(d, "users", "avatar TEXT");
    d.exec("PRAGMA foreign_keys = ON;");
    g.__pageDb = d;
  }
  return g.__pageDb;
}

/** Columns added after a table was first released (SQLite has no ADD COLUMN IF NOT EXISTS). */
function addColumn(d: DatabaseSync, table: string, column: string) {
  const name = column.split(" ")[0];
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === name)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
}

/** Small app-wide key/value store (update status, one-off flags). Values are JSON. */
export function getAppMeta<T>(key: string): T | undefined {
  const row = db().prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export function setAppMeta(key: string, value: unknown) {
  if (value === undefined) db().prepare("DELETE FROM app_meta WHERE key = ?").run(key);
  else db().prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
}

export function insertPing(row: PingRow) {
  db()
    .prepare("INSERT INTO pings (service_id, ts, up, status, latency_ms) VALUES (?, ?, ?, ?, ?)")
    .run(row.service_id, row.ts, row.up, row.status, row.latency_ms);
}

export function latestPing(serviceId: string): PingRow | undefined {
  return db()
    .prepare("SELECT * FROM pings WHERE service_id = ? ORDER BY ts DESC LIMIT 1")
    .get(serviceId) as PingRow | undefined;
}

export function pingsSince(serviceId: string, since: number): PingRow[] {
  return db()
    .prepare("SELECT * FROM pings WHERE service_id = ? AND ts >= ? ORDER BY ts")
    .all(serviceId, since) as unknown as PingRow[];
}


// --- hourly rollups (long history) ---

export interface HourRow {
  service_id: string;
  hour: number;
  checks: number;
  up: number;
  avg_ms: number | null;
  p95_ms: number | null;
}

/** Hours of raw pings before `before` that have no rollup yet. */
export function unrolledHours(before: number): { service_id: string; hour: number }[] {
  return db()
    .prepare(
      `SELECT DISTINCT p.service_id, (p.ts / 3600000) * 3600000 AS hour FROM pings p
       WHERE p.ts < ? AND NOT EXISTS (
         SELECT 1 FROM pings_hourly h WHERE h.service_id = p.service_id AND h.hour = (p.ts / 3600000) * 3600000
       )`,
    )
    .all(before) as unknown as { service_id: string; hour: number }[];
}

export function pingsBetween(serviceId: string, from: number, to: number): PingRow[] {
  return db()
    .prepare("SELECT * FROM pings WHERE service_id = ? AND ts >= ? AND ts < ? ORDER BY ts")
    .all(serviceId, from, to) as unknown as PingRow[];
}

export function upsertHour(r: HourRow) {
  db()
    .prepare("INSERT OR REPLACE INTO pings_hourly (service_id, hour, checks, up, avg_ms, p95_ms) VALUES (?, ?, ?, ?, ?, ?)")
    .run(r.service_id, r.hour, r.checks, r.up, r.avg_ms, r.p95_ms);
}

export function hoursSince(serviceId: string, since: number): HourRow[] {
  return db()
    .prepare("SELECT * FROM pings_hourly WHERE service_id = ? AND hour >= ? ORDER BY hour")
    .all(serviceId, since) as unknown as HourRow[];
}

// --- incidents (outages detected by the monitor) ---

export interface IncidentRow {
  id: number;
  service_id: string;
  start: number;
  end: number | null;
  cause: string | null;
}

export function openIncident(serviceId: string, start: number, cause: string | null) {
  db().prepare("INSERT INTO incidents (service_id, start, cause) VALUES (?, ?, ?)").run(serviceId, start, cause);
}

export function closeIncident(serviceId: string, end: number) {
  db().prepare("UPDATE incidents SET end = ? WHERE service_id = ? AND end IS NULL").run(end, serviceId);
}

export function openIncidents(): IncidentRow[] {
  return db().prepare("SELECT * FROM incidents WHERE end IS NULL").all() as unknown as IncidentRow[];
}

export function incidentsSince(serviceId: string, since: number): IncidentRow[] {
  return db()
    .prepare("SELECT * FROM incidents WHERE service_id = ? AND (end IS NULL OR end >= ?) ORDER BY start DESC LIMIT 200")
    .all(serviceId, since) as unknown as IncidentRow[];
}

export function pruneHistory(rawBefore: number, longBefore: number) {
  db().prepare("DELETE FROM pings WHERE ts < ?").run(rawBefore);
  db().prepare("DELETE FROM pings_hourly WHERE hour < ?").run(longBefore);
  db().prepare("DELETE FROM incidents WHERE end IS NOT NULL AND end < ?").run(longBefore);
}
