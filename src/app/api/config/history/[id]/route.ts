import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { diffWithCurrent, getVersion, restoreVersion } from "@/lib/config/history";
import { audit } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** A snapshot and the diff restoring it would apply to the current file. */
export async function GET(_req: Request, { params }: Ctx) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const v = getVersion(Number((await params).id));
  if (!v) return NextResponse.json({ error: "No such version" }, { status: 404 });
  return NextResponse.json({ ...v, diff: diffWithCurrent(v) });
}

/** Restore this snapshot. */
export async function POST(req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (!admin || !sameOrigin(req)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const id = Number((await params).id);
  const v = restoreVersion(id, admin.username);
  if (!v) return NextResponse.json({ error: "No such version" }, { status: 404 });
  audit(admin.username, "config-restore", { file: v.file, version: id });
  return NextResponse.json({ ok: true, file: v.file });
}
