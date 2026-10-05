import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { savedStatus } from "@/lib/update/check";
import { fullStatus, guard } from "./_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Update status for admins. ?brief=1 skips the Docker preflight (for the header badge). */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  if (new URL(req.url).searchParams.get("brief") === "1") {
    const s = savedStatus(loadConfig().settings.updates);
    return NextResponse.json({ available: s.available, version: s.latest?.version, current: s.current.version });
  }
  return NextResponse.json(await fullStatus());
}
