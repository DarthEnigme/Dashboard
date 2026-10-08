import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { requireUser, sameOrigin } from "@/lib/auth";
import { hashPassword, MIN_PASSWORD, verifyPassword } from "@/lib/auth/password";
import { clearFailures, isLimited, recordFailure } from "@/lib/auth/ratelimit";
import * as users from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET() {
  const me = await requireUser();
  if (!me) return err("Sign in first", 401);
  return NextResponse.json(me);
}

/**
 * Your own account: { name } and { currentPassword, newPassword }.
 * Email, role and SSO links stay with admins (email links SSO sign-ins to accounts).
 */
export async function PATCH(req: Request) {
  const me = await requireUser();
  if (!me) return err("Sign in first", 401);
  if (!sameOrigin(req)) return err("Cross-site request refused", 403);
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { name?: string | null; currentPassword?: string; newPassword?: string };

  if (b.name !== undefined && b.name !== null && (typeof b.name !== "string" || b.name.length > 80)) return err("Name: at most 80 characters");

  let passwordHash: string | undefined;
  if (b.newPassword !== undefined) {
    if (!loadConfig().settings.auth.local.enabled) return err("Password sign-in is turned off");
    if (!me.hasPassword) return err("This account signs in through SSO or LDAP; ask an admin to set a password");
    if (typeof b.newPassword !== "string" || b.newPassword.length < MIN_PASSWORD) return err(`New password: at least ${MIN_PASSWORD} characters`);
    const limitKey = `profile|${me.id}`;
    if (isLimited(limitKey)) return err("Too many wrong passwords. Try again in 15 minutes.", 429);
    if (!(await verifyPassword(b.currentPassword ?? "", users.passwordHash(me.id)))) {
      recordFailure(limitKey);
      return err("The current password is wrong", 403);
    }
    clearFailures(limitKey);
    passwordHash = await hashPassword(b.newPassword);
  }

  users.updateUser(me.id, { name: b.name === undefined ? undefined : b.name?.trim() || null, passwordHash });
  users.audit(me.username, "profile-update", { name: b.name !== undefined || undefined, password: passwordHash ? "changed" : undefined });
  return NextResponse.json(users.getUser(me.id));
}
