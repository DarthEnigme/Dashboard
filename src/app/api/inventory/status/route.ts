import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/auth";
import { deviceStatuses } from "@/lib/inventory/store";

export const dynamic = "force-dynamic";

/** { [deviceId]: { up, latencyMs?, error? } } for devices with an IP or host name (checked at most every 30 s). */
export async function GET() {
  const g = await guardPermission("inventory", undefined, "the inventory");
  if ("error" in g) return g.error;
  return NextResponse.json(await deviceStatuses());
}
