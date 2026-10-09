import { db, getAppMeta, setAppMeta } from "./db";

// Recorded widget numbers (opt-in per widget with `record: true`). Raw samples are kept 7 days,
// hourly averages (with min and max) as long as the status history.

let ready = false;
function init() {
  if (ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS metrics (service_id TEXT NOT NULL, key TEXT NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS metrics_by_key ON metrics (service_id, key, ts);
    CREATE TABLE IF NOT EXISTS metrics_hourly (
      service_id TEXT NOT NULL, key TEXT NOT NULL, hour INTEGER NOT NULL,
      avg REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL, n INTEGER NOT NULL,
      PRIMARY KEY (service_id, key, hour)
    );
  `);
  ready = true;
}

export interface Sample {
  key: string;
  value: number;
}

export function insertMetrics(serviceId: string, ts: number, samples: Sample[]) {
  init();
  const stmt = db().prepare("INSERT INTO metrics (service_id, key, ts, value) VALUES (?, ?, ?, ?)");
  for (const s of samples) stmt.run(serviceId, s.key, ts, s.value);
}

/** The newest value of every recorded field (newer than `since`), for the Prometheus export. */
export function latestMetrics(since: number): { service_id: string; key: string; value: number }[] {
  init();
  return db()
    .prepare(
      `SELECT m.service_id, m.key, m.value FROM metrics m
       JOIN (SELECT service_id, key, MAX(ts) AS ts FROM metrics WHERE ts >= ? GROUP BY service_id, key) l
         ON l.service_id = m.service_id AND l.key = m.key AND l.ts = m.ts
       ORDER BY m.service_id, m.key`,
    )
    .all(since) as { service_id: string; key: string; value: number }[];
}

export interface Point {
  t: number;
  v: number;
  min?: number;
  max?: number;
}

/** Raw points (≤ 7 days back) or hourly averages, per key. */
export function metricSeries(serviceId: string, from: number, to: number, hourly: boolean): Map<string, Point[]> {
  init();
  const out = new Map<string, Point[]>();
  const rows = hourly
    ? (db()
        .prepare("SELECT key, hour AS t, avg AS v, min, max FROM metrics_hourly WHERE service_id = ? AND hour >= ? AND hour < ? ORDER BY hour")
        .all(serviceId, from, to) as unknown as ({ key: string } & Point)[])
    : (db()
        .prepare("SELECT key, ts AS t, value AS v FROM metrics WHERE service_id = ? AND ts >= ? AND ts < ? ORDER BY ts")
        .all(serviceId, from, to) as unknown as ({ key: string } & Point)[]);
  for (const { key, ...p } of rows) {
    const list = out.get(key) ?? [];
    list.push(p);
    out.set(key, list);
  }
  return out;
}

const HOUR = 3_600_000;

/** Roll finished hours of raw samples into metrics_hourly (from where the last pass stopped). */
export function rollupMetrics(now = Date.now()) {
  init();
  const before = Math.floor(now / HOUR) * HOUR;
  const from = getAppMeta<number>("metrics.rolledUntil") ?? 0;
  if (from >= before) return;
  db()
    .prepare(
      `INSERT OR REPLACE INTO metrics_hourly (service_id, key, hour, avg, min, max, n)
       SELECT service_id, key, (ts / ${HOUR}) * ${HOUR} AS hour, AVG(value), MIN(value), MAX(value), COUNT(*)
       FROM metrics WHERE ts >= ? AND ts < ?
       GROUP BY service_id, key, hour`,
    )
    .run(from, before);
  setAppMeta("metrics.rolledUntil", before);
}

export function pruneMetrics(rawBefore: number, hourlyBefore: number) {
  init();
  db().prepare("DELETE FROM metrics WHERE ts < ?").run(rawBefore);
  db().prepare("DELETE FROM metrics_hourly WHERE hour < ?").run(hourlyBefore);
}

/** Evenly thin a series to at most `n` points (for sparklines). */
export function thin<T>(points: T[], n: number): T[] {
  if (points.length <= n) return points;
  const step = points.length / n;
  return Array.from({ length: n }, (_, i) => points[Math.min(points.length - 1, Math.round(i * step + step - 1))]);
}

/** Average of the points in each of `count` equal slots of [from, to); null where there are none. */
export function bucketMetric(points: Point[], from: number, to: number, count: number): (number | null)[] {
  const size = (to - from) / count;
  const sum = new Array<number>(count).fill(0);
  const n = new Array<number>(count).fill(0);
  for (const p of points) {
    const i = Math.floor((p.t - from) / size);
    if (i < 0 || i >= count) continue;
    sum[i] += p.v;
    n[i]++;
  }
  return sum.map((s, i) => (n[i] ? s / n[i] : null));
}
