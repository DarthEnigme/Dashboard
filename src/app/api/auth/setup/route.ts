import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/auth";
import { hashPassword, MIN_PASSWORD } from "@/lib/auth/password";
import { startSession } from "@/lib/auth/sessions";
import * as users from "@/lib/auth/users";
import { readRaw } from "@/lib/config/load";
import { APPS } from "@/lib/config/schema";
import { writeConfig } from "@/lib/config/write";

export const dynamic = "force-dynamic";

/** First run only: create the first admin account and pick the apps to turn on. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  if (users.countUsers() > 0) return NextResponse.json({ error: "Setup is already done" }, { status: 409 });
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const { username = "", password = "", email } = body as Record<string, string>;
  const apps = body.apps;
  if (apps !== undefined && !(Array.isArray(apps) && apps.every((a) => (APPS as readonly unknown[]).includes(a)))) {
    return NextResponse.json({ error: `Apps: any of ${APPS.join(", ")}` }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(username)) {
    return NextResponse.json({ error: "Username: 2–32 letters, digits, dots, dashes or underscores" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password: at least ${MIN_PASSWORD} characters` }, { status: 400 });
  }
  const passwordHash = await hashPassword(password);
  // Re-check after the (slow) hash: another setup request may have finished meanwhile.
  if (users.countUsers() > 0) return NextResponse.json({ error: "Setup is already done" }, { status: 409 });
  if (apps !== undefined) {
    const settings = readRaw("settings");
    const written = writeConfig("settings", { ...(settings && typeof settings === "object" ? settings : {}), apps: [...new Set(apps)] });
    if (!written.ok) return NextResponse.json({ error: written.error }, { status: 422 });
  }
  const user = users.createUser({ username, email: email || null, role: "admin", passwordHash });
  users.audit(user.username, "setup");
  const res = NextResponse.json({ ok: true });
  await startSession(res, req, user.id, "setup");
  return res;
}
