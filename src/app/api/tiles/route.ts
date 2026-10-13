import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { serviceIds } from "@/lib/config/slug";
import { serviceVisibility } from "@/lib/config/sanitize";
import { seeFilter } from "@/lib/auth";
import { cached } from "@/lib/cache";
import { checkSpec, describeCheck, runCheck, type PingResult } from "@/lib/checks";
import { bucketsSince, latestPings } from "@/lib/db";
import type { Bucket } from "@/lib/history";
import { certFor } from "@/lib/monitor";
import { listMutes, mutedNow } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export interface Tile {
  ping: PingResult & { certWarn: boolean; muted: boolean };
  /** The last 24 hours in 48 half-hour slots, and the uptime over all of them. */
  history: { uptime: number | null; buckets: Bucket[] };
}

const DAY = 86_400_000;
const SLOTS = 48;

/** Slots of the last 24 hours for every service, shared by all viewers for a minute. */
const history = () =>
  cached("tiles|history", 60_000, async () => {
    const to = Date.now();
    return { from: to - DAY, rows: bucketsSince(to - DAY, DAY / SLOTS) };
  });

/**
 * What every tile of the dashboard needs, in one answer: each checked service's latest status and
 * its 24-hour bars. One request per refresh instead of two per tile (/api/ping and /api/history,
 * which the service page still uses).
 */
export async function GET() {
  const cfg = await getConfig();
  const see = await seeFilter();
  const { settings } = cfg;
  const ids = serviceIds(cfg.services);
  const maxAge = settings.pingInterval * 2000;
  const now = Date.now();
  const latest = latestPings(now - maxAge);
  const { from, rows } = await history();
  const mutes = listMutes(now);
  const out: Record<string, Tile> = {};

  await Promise.all(
    cfg.services.flatMap((g, gi) =>
      g.services.map(async (s, si) => {
        const check = checkSpec(s);
        if (!check || !serviceVisibility(g, s).every(see)) return;
        const id = ids[gi][si];
        const row = latest.get(id);
        // The monitor stores a result every ping interval; before its first pass, check now.
        const r: PingResult = row
          ? { up: !!row.up, status: row.status ?? undefined, latencyMs: row.latency_ms ?? undefined, at: row.ts }
          : await cached(`ping|${id}|${describeCheck(check)}`, 5000, () => runCheck(check));
        const cert = r.cert ?? certFor(id);
        const days = settings.alerts.certDays;

        const slots = rows.get(id);
        let checks = 0;
        let up = 0;
        const buckets: Bucket[] = Array.from({ length: SLOTS }, (_, i) => {
          const b = slots?.get(i);
          checks += b?.checks ?? 0;
          up += b?.up ?? 0;
          return { start: Math.round(from + (i * DAY) / SLOTS), uptime: b?.checks ? b.up / b.checks : null, avgLatency: b?.avgMs == null ? null : Math.round(b.avgMs), p95Latency: null, checks: b?.checks ?? 0 };
        });
        out[id] = {
          ping: { ...r, cert, certWarn: !!(cert && days && cert.daysLeft <= days), muted: !!mutedNow(settings.maintenance, mutes, id, new Date(now)) },
          history: { uptime: checks ? up / checks : null, buckets },
        };
      }),
    ),
  );
  return NextResponse.json(out);
}
