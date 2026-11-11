import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { DATA_DIR } from "./data-dir";
import { MIGRATIONS } from "./migrations";
import { finishRestore, restoreSnapshot, snapshotDb, SNAPSHOT_DIR } from "./snapshots";
import { LEGACY_PENDING, readJournal, writeJournal, type Journal } from "./update/journal";

export { DATA_DIR };

export interface PingRow {
  service_id: string;
  ts: number;
  up: number;
  status: number | null;
  latency_ms: number | null;
  /** 1 when made during maintenance: a failure then is left out of uptime. */
  maint?: number;
}

/** Checks that count for uptime: every one, except failures during maintenance. */
const COUNTED = "NOT (maint = 1 AND up = 0)";

// One handle per process: route handlers and the monitor may load this module separately.
const g = globalThis as typeof globalThis & { __pageDb?: DatabaseSync; __pageDbSchema?: number };

export function db(): DatabaseSync {
  // Code with newer schema steps than the open handle (a dev server reloading changed code keeps its
  // handle): open again, so the new steps run, after their snapshot, like at a start.
  if (g.__pageDb && g.__pageDbSchema !== SCHEMA_VERSION) {
    g.__pageDb.close();
    g.__pageDb = undefined;
  }
  if (!g.__pageDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, "page.db");
    finishRestore(file);
    let d = open(file);
    if (schemaVersion(d) > SCHEMA_VERSION) d = restoreAfterRollback(d, file);
    migrate(d);
    d.exec("PRAGMA foreign_keys = ON;");
    // Compile each SQL text once: most statements run on every check or every request.
    // (After the schema is in place: a statement compiled earlier would not see new columns.)
    const compile = d.prepare.bind(d);
    const statements = new Map<string, StatementSync>();
    d.prepare = (sql: string) => {
      let s = statements.get(sql);
      if (!s) {
        // Texts built from variable parts (column lists) are few; a runaway would still be bounded.
        if (statements.size >= 500) statements.clear();
        s = compile(sql);
        statements.set(sql, s);
      }
      return s;
    };
    g.__pageDb = d;
    g.__pageDbSchema = SCHEMA_VERSION;
  }
  return g.__pageDb;
}

function open(file: string): DatabaseSync {
  const d = new DatabaseSync(file);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  return d;
}

const schemaVersion = (d: DatabaseSync) => (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

// --- schema migrations ---

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Run the pending schema steps, after a snapshot when the database already holds data. */
function migrate(d: DatabaseSync) {
  const from = schemaVersion(d);
  if (from >= SCHEMA_VERSION) return;
  const used = d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
  if (used) snapshotDb(`pre-migrate-v${from}-v${SCHEMA_VERSION}`, d);
  for (let v = from; v < SCHEMA_VERSION; v++) {
    d.exec("BEGIN IMMEDIATE");
    try {
      // Another process may have migrated while this one waited for the lock.
      if (schemaVersion(d) <= v) {
        MIGRATIONS[v](d);
        d.exec(`PRAGMA user_version = ${v + 1}`);
      }
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw new Error(`Database migration to schema ${v + 1} failed (the database is unchanged by this step): ${(e as Error).message}`);
    }
  }
}

/**
 * The database is newer than this code: a newer NanoDash migrated it. When that happened during an
 * update that was then rolled back, put back the snapshot taken before the handover (the newer file is
 * kept next to it). Otherwise refuse to start rather than run against a schema this code doesn't know.
 */
function restoreAfterRollback(d: DatabaseSync, file: string): DatabaseSync {
  const v = schemaVersion(d);
  const journal = readJournal();
  let snapshot = journal?.snapshot;
  if (!snapshot) {
    try {
      // An update 0.6.0 started kept its record in app_meta.
      const row = d.prepare("SELECT value FROM app_meta WHERE key = ?").get(LEGACY_PENDING) as { value: string } | undefined;
      snapshot = row ? (JSON.parse(row.value) as Journal).snapshot : undefined;
    } catch {
      // no app_meta table or no readable record: nothing to restore
    }
  }
  // Fold the WAL into the file, so the copy kept aside is whole on its own.
  d.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  d.close();
  if (!snapshot || !fs.existsSync(snapshot)) {
    throw new Error(
      `${file} has schema version ${v}, but this NanoDash only knows up to ${SCHEMA_VERSION}: a newer NanoDash upgraded it. ` +
        `Run that version again, or restore a copy from ${SNAPSHOT_DIR} (stop NanoDash, copy it over page.db, delete page.db-wal and page.db-shm).`,
    );
  }
  const kept = `${file}.schema-v${v}-${Date.now()}`;
  restoreSnapshot(snapshot, file, kept);
  console.warn(`[nanodash] update rolled back: restored the database from ${snapshot} (the upgraded one is kept as ${kept})`);
  const restored = open(file);
  if (schemaVersion(restored) > SCHEMA_VERSION) {
    restored.close();
    throw new Error(`The snapshot ${snapshot} is also newer than this NanoDash (schema ${SCHEMA_VERSION}).`);
  }
  // For reconcilePendingUpdate: whatever was saved in the newer version is only in the kept file now.
  if (journal) writeJournal({ ...journal, restored: { snapshot, kept, at: new Date().toISOString() } });
  return restored;
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

let txDepth = 0;

/** Run `fn` in one write transaction: all of its changes land, or none do. Called inside one, it joins it. */
export function transaction<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  db().exec("BEGIN IMMEDIATE");
  txDepth++;
  try {
    const out = fn();
    db().exec("COMMIT");
    return out;
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  } finally {
    txDepth--;
  }
}

export function setAppMeta(key: string, value: unknown) {
  if (value === undefined) db().prepare("DELETE FROM app_meta WHERE key = ?").run(key);
  else db().prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
}

export function insertPing(row: PingRow) {
  db()
    .prepare("INSERT INTO pings (service_id, ts, up, status, latency_ms, maint) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.service_id, row.ts, row.up, row.status, row.latency_ms, row.maint ?? 0);
}

export function latestPing(serviceId: string): PingRow | undefined {
  return db()
    .prepare("SELECT * FROM pings WHERE service_id = ? ORDER BY ts DESC LIMIT 1")
    .get(serviceId) as PingRow | undefined;
}

/** Checks counted for uptime and checks that were up since `since`, per service (one pass, for the monitoring panel). */
export function uptimeSince(since: number): Map<string, { checks: number; up: number }> {
  const rows = db().prepare(`SELECT service_id, COUNT(*) AS checks, SUM(up) AS up FROM pings WHERE ts >= ? AND ${COUNTED} GROUP BY service_id`).all(since) as unknown as {
    service_id: string;
    checks: number;
    up: number;
  }[];
  return new Map(rows.map((r) => [r.service_id, { checks: r.checks, up: r.up }]));
}

/** The newest check of every service, among those made since `since`. */
export function latestPings(since: number): Map<string, PingRow> {
  const rows = db()
    .prepare("SELECT p.* FROM pings p JOIN (SELECT service_id, MAX(ts) AS ts FROM pings WHERE ts >= ? GROUP BY service_id) m ON m.service_id = p.service_id AND m.ts = p.ts")
    .all(since) as unknown as PingRow[];
  return new Map(rows.map((r) => [r.service_id, r]));
}

/** Checks since `since` in slots of `sizeMs`, per service and slot number: counts, and the average latency of the ones that passed. */
export function bucketsSince(since: number, sizeMs: number): Map<string, Map<number, { checks: number; up: number; avgMs: number | null }>> {
  const rows = db()
    .prepare(
      `SELECT service_id, CAST((ts - ?) / ? AS INTEGER) AS slot, COUNT(*) AS checks, SUM(up) AS up, AVG(CASE WHEN up = 1 THEN latency_ms END) AS avgMs
       FROM pings WHERE ts >= ? AND ${COUNTED} GROUP BY service_id, slot`,
    )
    .all(since, sizeMs, since) as unknown as { service_id: string; slot: number; checks: number; up: number; avgMs: number | null }[];
  const out = new Map<string, Map<number, { checks: number; up: number; avgMs: number | null }>>();
  for (const { service_id, slot, ...r } of rows) {
    let m = out.get(service_id);
    if (!m) out.set(service_id, (m = new Map()));
    m.set(slot, r);
  }
  return out;
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
  /** 1 when it began during maintenance (not a mere mute). */
  planned: number;
  /** Planned outages: the maintenance note for admins, and the one for the status page. */
  note: string | null;
  public_note: string | null;
}

export function openIncident(serviceId: string, start: number, cause: string | null, planned = false, notes: { note?: string; publicNote?: string } = {}) {
  db()
    .prepare("INSERT INTO incidents (service_id, start, cause, planned, note, public_note) VALUES (?, ?, ?, ?, ?, ?)")
    .run(serviceId, start, cause, planned ? 1 : 0, notes.note ?? null, notes.publicNote ?? null);
}

export function closeIncident(serviceId: string, end: number) {
  db().prepare("UPDATE incidents SET end = ? WHERE service_id = ? AND end IS NULL").run(end, serviceId);
}

export function openIncidents(): IncidentRow[] {
  return db().prepare("SELECT * FROM incidents WHERE end IS NULL").all() as unknown as IncidentRow[];
}

/** Outages that started since `since`, per service. */
export function incidentCountsSince(since: number): Map<string, number> {
  const rows = db().prepare("SELECT service_id, COUNT(*) AS n FROM incidents WHERE start >= ? GROUP BY service_id").all(since) as unknown as { service_id: string; n: number }[];
  return new Map(rows.map((r) => [r.service_id, r.n]));
}

/** Every outage that was still going on at `since` or began after it, newest first. */
export function incidentsOverlapping(since: number): IncidentRow[] {
  return db().prepare("SELECT * FROM incidents WHERE end IS NULL OR end >= ? ORDER BY start DESC LIMIT 200").all(since) as unknown as IncidentRow[];
}

/**
 * Checks made and passed per service and hour since `since`: finished hours from the rollups, and
 * from `rawFrom` on (hours that may not be rolled up yet) counted from the raw checks.
 */
export function hourlyChecksSince(since: number, rawFrom: number): Map<string, { hour: number; checks: number; up: number }[]> {
  const rows = db()
    .prepare(
      `SELECT service_id, hour, checks, up FROM pings_hourly WHERE hour >= ? AND hour < ?
       UNION ALL
       SELECT service_id, (ts / 3600000) * 3600000 AS hour, COUNT(*) AS checks, SUM(up) AS up FROM pings WHERE ts >= ? AND ${COUNTED} GROUP BY service_id, hour`,
    )
    .all(since, rawFrom, Math.max(since, rawFrom)) as unknown as { service_id: string; hour: number; checks: number; up: number }[];
  const out = new Map<string, { hour: number; checks: number; up: number }[]>();
  for (const { service_id, ...r } of rows) {
    const list = out.get(service_id);
    if (list) list.push(r);
    else out.set(service_id, [r]);
  }
  return out;
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
