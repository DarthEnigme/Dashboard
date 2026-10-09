import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { backupDir, backupStatus, listBackups, runBackup } from "@/lib/backup";
import { loadConfig } from "@/lib/config/load";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const forbidden = () => NextResponse.json({ error: "Admins only" }, { status: 403 });

const state = () => {
  const cfg = loadConfig().settings.backup;
  return { backups: listBackups(), last: backupStatus() ?? null, dir: backupDir(cfg), enabled: cfg.enabled, time: cfg.time, keep: cfg.keep };
};

/** The backups on disk, the last run, and where they go. */
export async function GET() {
  if (!(await requireAdmin())) return forbidden();
  return NextResponse.json(state());
}

/** Back up now. */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  const r = await runBackup(admin.username);
  audit(admin.username, "backup-create", r.ok ? { name: r.name, size: r.size } : { error: r.error });
  if (!r.ok) return NextResponse.json({ error: r.error, ...state() }, { status: 500 });
  return NextResponse.json(state(), { status: 201 });
}
