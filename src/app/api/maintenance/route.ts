import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { loadConfig } from "@/lib/config/load";
import { findService } from "@/lib/config/lookup";
import { ALL, inWindow, listMutes, mute, unmute } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Admins only" }, { status: 403 });
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Longest timed mute: a week. Longer than that is "until I turn it back on". */
const MAX_MINUTES = 7 * 24 * 60;

const state = () => {
  const now = new Date();
  return { mutes: listMutes(now.getTime()), windows: loadConfig().settings.maintenance.map((w) => ({ ...w, active: inWindow(w, now) })) };
};

/** One-off mutes in force, and the recurring windows with whether each is active now. */
export async function GET() {
  if (!(await requireAdmin())) return forbidden();
  return NextResponse.json(state());
}

/** { service: an id or "*" for everything, minutes: 1–10080 or null (until turned back on) } */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  if (!sameOrigin(req)) return bad("Cross-site request refused", 403);
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { service?: unknown; minutes?: unknown };
  if (typeof b.service !== "string" || !b.service) return bad("service required");
  if (b.service !== ALL && !(await findService(b.service))) return bad("No such service", 404);
  const forMinutes = b.minutes === null || b.minutes === undefined ? null : Number(b.minutes);
  if (forMinutes !== null && !(Number.isInteger(forMinutes) && forMinutes >= 1 && forMinutes <= MAX_MINUTES)) return bad("minutes must be 1–10080, or null");
  mute(b.service, forMinutes, admin.username);
  audit(admin.username, "alerts-mute", { service: b.service, minutes: forMinutes });
  return NextResponse.json(state(), { status: 201 });
}

/** ?service= (an id or "*") turns its alerts back on. */
export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  if (!sameOrigin(req)) return bad("Cross-site request refused", 403);
  const service = new URL(req.url).searchParams.get("service");
  if (!service) return bad("service required");
  unmute(service);
  audit(admin.username, "alerts-unmute", { service });
  return NextResponse.json(state());
}
