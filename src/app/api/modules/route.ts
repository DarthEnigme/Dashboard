import { NextResponse } from "next/server";
import { canEdit } from "@/lib/auth";
import { loadConfig } from "@/lib/config/load";
import { moduleStatus } from "@/lib/module-retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Apps turned off whose data is waiting to be deleted (Settings → General → Apps). */
export async function GET() {
  if (!(await canEdit())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ off: moduleStatus(), retentionDays: loadConfig().settings.backup.moduleRetentionDays });
}
