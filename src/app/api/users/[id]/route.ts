import { NextResponse } from "next/server";
import { publicOrigin, requireAdmin, sameOrigin } from "@/lib/auth";
import { setManualGroups } from "@/lib/auth/groups";
import { createResetToken, RESET_HOURS, revokeUserSessions } from "@/lib/auth/sessions";
import { hashPassword, MIN_PASSWORD } from "@/lib/auth/password";
import * as users from "@/lib/auth/users";
import { removeUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

type Ctx = { params: Promise<{ id: string }> };

/**
 * Change role, disable, reset password, edit email/name, unlink an SSO identity, set groups
 * ({ groups: [names] }), sign out everywhere ({ signOut: true }), turn off 2FA ({ resetTwoFactor: true }),
 * or make a one-time link to set a password ({ resetLink: true } → { link }).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (!admin || !sameOrigin(req)) return err("Admins only", 403);
  const id = Number((await params).id);
  const target = users.getUser(id);
  if (!target) return err("No such user", 404);
  const b = ((await req.json().catch(() => ({}))) ?? {}) as {
    role?: string;
    disabled?: boolean;
    password?: string | null;
    email?: string | null;
    name?: string | null;
    unlink?: { provider: string; subject: string };
    groups?: string[];
    signOut?: boolean;
    resetTwoFactor?: boolean;
    resetLink?: boolean;
  };

  // Never leave the instance without an active admin.
  const losesAdmin = target.role === "admin" && !target.disabled && ((b.role && b.role !== "admin") || b.disabled === true);
  if (losesAdmin && users.countAdmins() <= 1) return err("This is the last admin. Make someone else admin first.", 409);
  if (b.password && b.password.length < MIN_PASSWORD) return err(`Password: at least ${MIN_PASSWORD} characters`);

  users.updateUser(id, {
    role: b.role === "admin" || b.role === "user" ? b.role : undefined,
    disabled: b.disabled,
    email: b.email === undefined ? undefined : b.email?.trim() || null,
    name: b.name === undefined ? undefined : b.name?.trim() || null,
    passwordHash: b.password === undefined ? undefined : b.password ? await hashPassword(b.password) : null,
  });
  if (b.unlink) users.unlinkIdentity(id, b.unlink.provider, b.unlink.subject);
  if (b.groups !== undefined) {
    if (!Array.isArray(b.groups) || b.groups.some((g) => typeof g !== "string")) return err("groups must be a list of names");
    try {
      setManualGroups(id, b.groups);
    } catch (e) {
      return err((e as Error).message);
    }
  }
  if (b.resetTwoFactor) users.setTwoFactor(id, null);
  // A disabled account, a new password or a reset 2FA ends its sessions; so does "sign out everywhere".
  if (b.signOut || b.disabled === true || b.password !== undefined || b.resetTwoFactor) revokeUserSessions(id);
  let link: string | undefined;
  if (b.resetLink) link = `${publicOrigin(req)}/reset?token=${createResetToken(id, admin.username)}`;
  users.audit(admin.username, "user-update", {
    username: target.username,
    ...b,
    password: b.password === undefined ? undefined : b.password ? "changed" : "removed",
  });
  return NextResponse.json(link ? { ...users.getUser(id), link, linkHours: RESET_HOURS } : users.getUser(id));
}

export async function DELETE(req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (!admin || !sameOrigin(req)) return err("Admins only", 403);
  const id = Number((await params).id);
  const target = users.getUser(id);
  if (!target) return err("No such user", 404);
  if (target.id === admin.id) return err("You can't delete your own account");
  if (target.role === "admin" && users.countAdmins() <= 1) return err("This is the last admin", 409);
  users.deleteUser(id);
  removeUpload(target.avatar);
  users.audit(admin.username, "user-delete", { username: target.username });
  return NextResponse.json({ ok: true });
}
