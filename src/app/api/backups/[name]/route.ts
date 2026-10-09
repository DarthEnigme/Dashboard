import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { backupPath, backupStatus, listBackups } from "@/lib/backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ name: string }> };

/** Download a backup (it holds secrets: admins only, and every download is audited). */
export async function GET(_req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { name } = await params;
  const p = backupPath(name);
  if (!p) return NextResponse.json({ error: "No such backup" }, { status: 404 });
  audit(admin.username, "backup-download", { name });
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  const { name } = await params;
  const p = backupPath(name);
  if (!p) return NextResponse.json({ error: "No such backup" }, { status: 404 });
  fs.rmSync(p, { force: true });
  audit(admin.username, "backup-delete", { name });
  return NextResponse.json({ backups: listBackups(), last: backupStatus() ?? null });
}
