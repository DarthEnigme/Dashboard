import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { canEdit, sameOrigin } from "@/lib/auth";
import { sendAlert } from "@/lib/alerts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await canEdit()) || !sameOrigin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const errors = await sendAlert(loadConfig().settings.alerts, { service: "Page", status: "test" });
  if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
  return NextResponse.json({ ok: true });
}
