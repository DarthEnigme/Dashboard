import { NextResponse } from "next/server";
import { findService } from "@/lib/config/lookup";
import { seeFilter } from "@/lib/auth";
import { loadConfig } from "@/lib/config/load";
import { cached } from "@/lib/cache";
import { latestPing } from "@/lib/db";
import { checkSpec, describeCheck, runCheck, type PingResult } from "@/lib/checks";
import { certFor } from "@/lib/monitor";

export const dynamic = "force-dynamic";

/** Latest status of a service, plus `certWarn` when its certificate is within alerts.certDays of expiry. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const check = checkSpec(await findService(id, await seeFilter()));
  if (!check) return NextResponse.json({ error: "No ping target" }, { status: 404 });
  const { settings } = loadConfig();
  const withCert = (r: PingResult) => {
    const cert = r.cert ?? certFor(id);
    const days = settings.alerts.certDays;
    return { ...r, cert, certWarn: !!(cert && days && cert.daysLeft <= days) };
  };

  // The background monitor stores a result every ping interval; use it while it's fresh.
  const maxAge = settings.pingInterval * 2000;
  try {
    const row = latestPing(id);
    if (row && Date.now() - row.ts < maxAge) {
      return NextResponse.json(
        withCert({
          up: !!row.up,
          status: row.status ?? undefined,
          latencyMs: row.latency_ms ?? undefined,
          at: row.ts,
        }),
      );
    }
  } catch {
    // No database (read-only data dir): fall through to a live check.
  }
  return NextResponse.json(withCert(await cached(`ping|${id}|${describeCheck(check)}`, 5000, () => runCheck(check))));
}
