import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { savedStatus } from "@/lib/update/check";
import { applyUpdate, preflight } from "@/lib/update/apply";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start installing the latest known version. Answers right away (202); downloading can take a
 * while, so progress is sent as "update" events on /api/events and in GET /api/update.
 */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const cfg = loadConfig().settings.updates;
  const status = savedStatus(cfg);
  const { version } = ((await req.json().catch(() => ({}))) ?? {}) as { version?: string };
  if (!status.available || !status.latest) return NextResponse.json({ error: "Already up to date" }, { status: 409 });
  // The admin confirmed a specific version; refuse if a newer check changed it meanwhile.
  if (version && version !== status.latest.version) return NextResponse.json({ error: `Latest is now ${status.latest.version}; review it first` }, { status: 409 });
  const pf = await preflight(cfg);
  if (!pf.canApply) return NextResponse.json({ error: pf.reason }, { status: 409 });
  applyUpdate(cfg, status, g.admin.username).catch((e) => console.error("[page] update failed:", e));
  return NextResponse.json({ ok: true, target: status.latest.version }, { status: 202 });
}
