import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/auth";
import { hashPassword, MIN_PASSWORD } from "@/lib/auth/password";
import { cookieOptions, isHttps, SESSION_COOKIE, sessionToken } from "@/lib/auth/session";
import * as users from "@/lib/auth/users";

export const dynamic = "force-dynamic";

/** First run only: create the first admin account. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  if (users.countUsers() > 0) return NextResponse.json({ error: "Setup is already done" }, { status: 409 });
  const { username = "", password = "", email } = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, string>;
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(username)) {
    return NextResponse.json({ error: "Username: 2–32 letters, digits, dots, dashes or underscores" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password: at least ${MIN_PASSWORD} characters` }, { status: 400 });
  }
  const user = users.createUser({ username, email: email || null, role: "admin", passwordHash: await hashPassword(password) });
  users.audit(user.username, "setup");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(user.id), cookieOptions(isHttps(req)));
  return res;
}
