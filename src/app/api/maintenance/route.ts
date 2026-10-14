import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { loadConfig } from "@/lib/config/load";
import { findService } from "@/lib/config/lookup";
import { ALL, endMaintenance, inWindow, listMaintenance, listMutes, mute, startMaintenance, unmute } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Admins only" }, { status: 403 });
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Longest timed mute or maintenance: a week. Longer than that is "until turned back on / ended". */
const MAX_MINUTES = 7 * 24 * 60;
/** Maintenance can be planned this far ahead. */
const MAX_AHEAD = 90 * 24 * 60 * 60_000;

const state = () => {
  const now = new Date();
  return {
    mutes: listMutes(now.getTime()),
    maintenance: listMaintenance(now.getTime()),
    windows: loadConfig().settings.maintenance.map((w) => ({ ...w, active: inWindow(w, now) })),
  };
};

/** Mutes in force, one-off maintenance under way or planned, and the recurring windows with whether each is active now. */
export async function GET() {
  if (!(await requireAdmin())) return forbidden();
  return NextResponse.json(state());
}

/**
 * Mute: { kind?: "mute", service: an id or "*", minutes: 1–10080 or null (until turned back on), note? }
 * Maintenance: { kind: "maintenance", service, start?: ms (default now), end?: ms | null, or minutes instead of end, note?, publicNote? }
 * Notes are cut to 200 characters.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  if (!sameOrigin(req)) return bad("Cross-site request refused", 403);
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (typeof b.service !== "string" || !b.service) return bad("service required");
  if (b.service !== ALL && !(await findService(b.service))) return bad("No such service", 404);
  const note = typeof b.note === "string" ? b.note : undefined;
  const forMinutes = b.minutes === null || b.minutes === undefined ? null : Number(b.minutes);
  if (forMinutes !== null && !(Number.isInteger(forMinutes) && forMinutes >= 1 && forMinutes <= MAX_MINUTES)) return bad("minutes must be 1–10080, or null");

  if (b.kind === "maintenance") {
    const now = Date.now();
    const start = b.start === undefined || b.start === null ? now : Number(b.start);
    if (!Number.isFinite(start) || start > now + MAX_AHEAD) return bad("start must be a time within 90 days");
    let end: number | null = forMinutes === null ? null : Math.max(start, now) + forMinutes * 60_000;
    if (b.end !== undefined && b.end !== null) end = Number(b.end);
    if (end !== null && (!Number.isFinite(end) || end <= Math.max(start, now) || end - start > MAX_MINUTES * 60_000)) return bad("end must be after start, within a week");
    const publicNote = typeof b.publicNote === "string" ? b.publicNote : undefined;
    const m = startMaintenance(b.service, start, end, admin.username, now, { note, publicNote });
    audit(admin.username, "maintenance-start", { service: b.service, start: new Date(m.start).toISOString(), end: m.end && new Date(m.end).toISOString(), note: m.note, publicNote: m.publicNote });
    return NextResponse.json(state(), { status: 201 });
  }

  mute(b.service, forMinutes, admin.username, Date.now(), { note });
  audit(admin.username, "alerts-mute", { service: b.service, minutes: forMinutes, note: note?.trim() || undefined });
  return NextResponse.json(state(), { status: 201 });
}

/** ?service= (an id or "*") turns its alerts back on; ?maintenance= (an id) ends that maintenance, or cancels it if not started. */
export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  if (!sameOrigin(req)) return bad("Cross-site request refused", 403);
  const q = new URL(req.url).searchParams;
  const id = q.get("maintenance");
  if (id) {
    if (!endMaintenance(id)) return bad("No such maintenance", 404);
    audit(admin.username, "maintenance-end", { id });
    return NextResponse.json(state());
  }
  const service = q.get("service");
  if (!service) return bad("service or maintenance required");
  unmute(service);
  audit(admin.username, "alerts-unmute", { service });
  return NextResponse.json(state());
}
