import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { savedStatus, type UpdateStatus } from "@/lib/update/check";
import { preflight, updateHistory, updateProgress } from "@/lib/update/apply";

/** Admins only; changes must also be same-origin. */
export async function guard(req?: Request) {
  const admin = await requireAdmin();
  if (!admin) return { error: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  if (req && req.method !== "GET" && !sameOrigin(req)) return { error: NextResponse.json({ error: "Cross-site request refused" }, { status: 403 }) };
  return { admin };
}

/** Everything the Updates panel shows. */
export async function fullStatus(status?: UpdateStatus) {
  const cfg = loadConfig().settings.updates;
  const pf = await preflight(cfg);
  return {
    ...(status ?? savedStatus(cfg)),
    settings: { check: cfg.check, auto: cfg.auto, window: cfg.window },
    progress: updateProgress(),
    history: updateHistory(),
    preflight: { canApply: pf.canApply, reason: pf.reason, container: pf.container, image: pf.image },
  };
}

export type FullStatus = Awaited<ReturnType<typeof fullStatus>>;
