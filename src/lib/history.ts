export interface Bucket {
  start: number;
  /** Share of successful checks, null when there were none. */
  uptime: number | null;
  avgLatency: number | null;
  p95Latency: number | null;
  checks: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const ranges = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, "90d": 90 * DAY } as const;
export type Range = keyof typeof ranges;
/** Raw pings are kept this long; longer ranges read hourly rollups. */
export const RAW_RETENTION = 7 * DAY;
export const usesRollups = (r: Range) => ranges[r] > RAW_RETENTION;

/** Nearest-rank percentile (q in 0..1); null for no values. */
export function percentile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

type Raw = { ts: number; up: number; latency_ms: number | null };

/** Split [from, to) into `count` equal buckets of raw ping results. */
export function bucketize(rows: Raw[], from: number, to: number, count = 48): Bucket[] {
  const size = (to - from) / count;
  const acc = Array.from({ length: count }, () => ({ n: 0, up: 0, lat: [] as number[] }));
  for (const r of rows) {
    const i = Math.floor((r.ts - from) / size);
    if (i < 0 || i >= count) continue;
    acc[i].n++;
    if (r.up) {
      acc[i].up++;
      if (r.latency_ms != null) acc[i].lat.push(r.latency_ms);
    }
  }
  return acc.map((b, i) => ({
    start: Math.round(from + i * size),
    uptime: b.n ? b.up / b.n : null,
    avgLatency: b.lat.length ? Math.round(b.lat.reduce((a, x) => a + x, 0) / b.lat.length) : null,
    p95Latency: percentile(b.lat, 0.95),
    checks: b.n,
  }));
}

/** One hour of raw pings → a rollup row. */
export function rollupHour(rows: Raw[]): { checks: number; up: number; avg_ms: number | null; p95_ms: number | null } {
  const lat = rows.filter((r) => r.up && r.latency_ms != null).map((r) => r.latency_ms!);
  return {
    checks: rows.length,
    up: rows.filter((r) => r.up).length,
    avg_ms: lat.length ? lat.reduce((a, x) => a + x, 0) / lat.length : null,
    p95_ms: percentile(lat, 0.95),
  };
}

type Hourly = { hour: number; checks: number; up: number; avg_ms: number | null; p95_ms: number | null };

/**
 * Buckets from hourly rollups. Uptime and average latency are weighted by check counts;
 * p95 is the worst hourly p95 in the bucket (a conservative approximation).
 */
export function bucketizeHourly(rows: Hourly[], from: number, to: number, count = 60): Bucket[] {
  const size = (to - from) / count;
  const acc = Array.from({ length: count }, () => ({ n: 0, up: 0, latSum: 0, latN: 0, p95: null as number | null }));
  for (const r of rows) {
    const i = Math.floor((r.hour - from) / size);
    if (i < 0 || i >= count) continue;
    const b = acc[i];
    b.n += r.checks;
    b.up += r.up;
    if (r.avg_ms != null && r.up) {
      b.latSum += r.avg_ms * r.up;
      b.latN += r.up;
    }
    if (r.p95_ms != null) b.p95 = Math.max(b.p95 ?? 0, r.p95_ms);
  }
  return acc.map((b, i) => ({
    start: Math.round(from + i * size),
    uptime: b.n ? b.up / b.n : null,
    avgLatency: b.latN ? Math.round(b.latSum / b.latN) : null,
    p95Latency: b.p95 === null ? null : Math.round(b.p95),
    checks: b.n,
  }));
}

/** Uptime across buckets, weighted by the number of checks. */
export function overallUptime(buckets: Bucket[]): number | null {
  const checks = buckets.reduce((a, b) => a + b.checks, 0);
  if (!checks) return null;
  return buckets.reduce((a, b) => a + (b.uptime ?? 0) * b.checks, 0) / checks;
}
