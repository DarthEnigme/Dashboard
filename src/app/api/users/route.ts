import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { hashPassword, MIN_PASSWORD } from "@/lib/auth/password";
import * as users from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const deny = () => NextResponse.json({ error: "Admins only" }, { status: 403 });

export async function GET() {
  if (!(await requireAdmin())) return deny();
  return NextResponse.json(users.listUsers());
}

/** Create a user. Without a password they can only sign in through LDAP/SSO/proxy (matched by email or username). */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin || !sameOrigin(req)) return deny();
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, string | undefined>;
  const username = b.username?.trim() ?? "";
  if (!/^[a-zA-Z0-9._@-]{2,64}$/.test(username)) {
    return NextResponse.json({ error: "Username: 2–64 letters, digits, . _ @ or -" }, { status: 400 });
  }
  if (users.findByUsername(username)) return NextResponse.json({ error: "That username is taken" }, { status: 409 });
  if (b.password && b.password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password: at least ${MIN_PASSWORD} characters` }, { status: 400 });
  }
  const user = users.createUser({
    username,
    email: b.email?.trim() || null,
    name: b.name?.trim() || null,
    role: b.role === "admin" ? "admin" : "user",
    passwordHash: b.password ? await hashPassword(b.password) : null,
  });
  users.audit(admin.username, "user-create", { username, role: user.role });
  return NextResponse.json(user, { status: 201 });
}
