import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { refreshStatus } from "@/lib/update/check";
import { fullStatus, guard } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Check now instead of waiting for the 6-hourly check. */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  return NextResponse.json(await fullStatus(await refreshStatus(loadConfig().settings.updates)));
}
