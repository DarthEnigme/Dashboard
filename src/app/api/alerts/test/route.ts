import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { canEdit, sameOrigin } from "@/lib/auth";
import { sendAlert, type AlertPayload } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/** { sample: "down" | "up" } sends a made-up outage through the message templates; otherwise a plain test. */
const samples: Record<string, AlertPayload> = {
  down: { service: "Example service", status: "down", url: "https://example.com", since: new Date().toISOString(), error: "Connection refused" },
  up: { service: "Example service", status: "up", url: "https://example.com", since: new Date().toISOString(), durationSeconds: 754 },
};

export async function POST(req: Request) {
  if (!(await canEdit()) || !sameOrigin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { sample } = ((await req.json().catch(() => ({}))) ?? {}) as { sample?: string };
  const payload = (sample && samples[sample]) || { service: "Page", status: "test" as const };
  const errors = await sendAlert(loadConfig().settings.alerts, payload);
  if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
  return NextResponse.json({ ok: true });
}
