import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/auth";
import { hashPassword, MIN_PASSWORD } from "@/lib/auth/password";
import { clientIp, isLimited, recordFailure } from "@/lib/auth/ratelimit";
import { resetTokenUser, revokeUserSessions } from "@/lib/auth/sessions";
import * as users from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const EXPIRED = "This link has expired or was already used. Ask an admin for a new one.";

/** ?token= → who the link is for (to greet them), without using it up. */
export async function GET(req: Request) {
  const id = resetTokenUser(new URL(req.url).searchParams.get("token") ?? "");
  const user = id ? users.getUser(id) : undefined;
  if (!user || user.disabled) return fail(EXPIRED, 404);
  return NextResponse.json({ username: user.username, name: user.name });
}

/** { token, password }: set the password, sign the account out everywhere. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused", 403);
  const limitKey = `reset|${clientIp(req)}`;
  if (isLimited(limitKey)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const { token = "", password = "" } = ((await req.json().catch(() => ({}))) ?? {}) as { token?: string; password?: string };
  if (password.length < MIN_PASSWORD) return fail(`Password: at least ${MIN_PASSWORD} characters`);
  const id = resetTokenUser(token, true);
  const user = id ? users.getUser(id) : undefined;
  if (!user || user.disabled) {
    recordFailure(limitKey);
    return fail(EXPIRED, 404);
  }
  users.updateUser(user.id, { passwordHash: await hashPassword(password) });
  revokeUserSessions(user.id);
  users.audit(user.username, "password-reset");
  return NextResponse.json({ ok: true, username: user.username });
}
