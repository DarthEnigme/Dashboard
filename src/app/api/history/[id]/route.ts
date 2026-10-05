import { NextResponse } from "next/server";
import { hoursSince, incidentsSince, pingsSince } from "@/lib/db";
import { findService } from "@/lib/config/lookup";
import { seeFilter } from "@/lib/auth";
import { bucketize, bucketizeHourly, overallUptime, percentile, ranges, usesRollups, type Range } from "@/lib/history";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await findService(id, await seeFilter()))) return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const param = q.get("range") ?? "24h";
  const range: Range = param in ranges ? (param as Range) : "24h";
  const to = Date.now();
  const from = to - ranges[range];
  try {
    let buckets;
    let p95: number | null;
    if (usesRollups(range)) {
      const hours = hoursSince(id, from);
      buckets = bucketizeHourly(hours, from, to);
      p95 = hours.reduce<number | null>((m, h) => (h.p95_ms == null ? m : Math.max(m ?? 0, h.p95_ms)), null);
    } else {
      const raw = pingsSince(id, from);
      buckets = bucketize(raw, from, to, range === "24h" ? 48 : 56);
      p95 = percentile(raw.filter((r) => r.up && r.latency_ms != null).map((r) => r.latency_ms!), 0.95);
    }
    const lat = buckets.filter((b) => b.avgLatency !== null);
    const body: Record<string, unknown> = {
      range,
      uptime: overallUptime(buckets),
      avgLatency: lat.length ? Math.round(lat.reduce((a, b) => a + b.avgLatency! * b.checks, 0) / lat.reduce((a, b) => a + b.checks, 0)) : null,
      p95Latency: p95 === null ? null : Math.round(p95),
      buckets,
    };
    if (q.get("incidents") === "1") body.incidents = incidentsSince(id, from);
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
