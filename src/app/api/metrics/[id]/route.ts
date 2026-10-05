import { NextResponse } from "next/server";
import { findService } from "@/lib/config/lookup";
import { seeFilter } from "@/lib/auth";
import { ranges, usesRollups, type Range } from "@/lib/history";
import { bucketMetric, metricSeries } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/** Recorded widget values for a service: one series per field label, in equal time slots. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await findService(id, await seeFilter()))) return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  const param = new URL(req.url).searchParams.get("range") ?? "24h";
  const range: Range = param in ranges ? (param as Range) : "24h";
  const to = Date.now();
  const from = to - ranges[range];
  const count = range === "24h" ? 96 : range === "7d" ? 84 : 90;
  try {
    const series = metricSeries(id, from, to, usesRollups(range));
    const size = (to - from) / count;
    return NextResponse.json({
      range,
      x: Array.from({ length: count }, (_, i) => Math.round(from + i * size)),
      series: [...series].map(([key, points]) => ({ key, values: bucketMetric(points, from, to, count), last: points[points.length - 1]?.v ?? null })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
