import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { clientAuth, ensureBootstrap, sameOrigin } from "@/lib/auth";
import { ldapAuthenticate } from "@/lib/auth/ldap";
import { resolveIdentity } from "@/lib/auth/identity";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/password";
import { clearFailures, clientIp, isLimited, recordFailure } from "@/lib/auth/ratelimit";
import { cookieOptions, isHttps, SESSION_COOKIE, sessionToken } from "@/lib/auth/session";
import * as users from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await clientAuth());
}

const fail = (error: string, status = 401) => NextResponse.json({ error }, { status });

/** Username/password login: a local password first, then LDAP if enabled. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused", 403);
  const { username = "", password = "" } = ((await req.json().catch(() => ({}))) ?? {}) as { username?: string; password?: string };
  const name = username.trim();
  if (!name || !password) return fail("Enter a username and password", 400);

  await ensureBootstrap();
  const limitKey = `${clientIp(req)}|${name.toLowerCase()}`;
  if (isLimited(limitKey)) return fail("Too many failed attempts. Try again in 15 minutes.", 429);

  const { auth } = loadConfig().settings;
  let user: users.User | undefined;
  let error = "Wrong username or password";

  const local = auth.local.enabled ? users.findByUsername(name) : undefined;
  if (local?.hasPassword) {
    if (await verifyPassword(password, users.passwordHash(local.id))) user = local;
  } else if (auth.ldap.enabled) {
    try {
      const identity = await ldapAuthenticate(auth.ldap, name, password);
      if (identity) {
        const r = resolveIdentity(identity, {
          signup: auth.ldap.signup,
          defaultRole: auth.defaultRole,
          adminGroup: auth.ldap.adminGroup,
          trustUsername: true,
        });
        if (r.ok) user = r.user;
        else error = r.error;
      }
    } catch (e) {
      console.error("[page] LDAP login failed:", e);
      return fail("The directory server could not be reached", 502);
    }
  }

  if (!local?.hasPassword && !auth.ldap.enabled) await burnPasswordCheck(password);
  if (!user || user.disabled) {
    recordFailure(limitKey);
    users.audit(name, "login-failed", { method: local?.hasPassword ? "local" : auth.ldap.enabled ? "ldap" : "local" });
    return fail(user?.disabled ? "This account is disabled." : error);
  }

  clearFailures(limitKey);
  users.audit(user.username, "login");
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(user.id), cookieOptions(isHttps(req)));
  return res;
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused", 403);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
