import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { loadConfig } from "../config/load";
import { PERMISSIONS, type Permission, type Visibility } from "../config/schema";
import { groupsOf, syncSsoGroups } from "./groups";
import { checkSession } from "./sessions";
import { hashPassword } from "./password";
import { resolveIdentity } from "./identity";
import { providerLabel } from "./oauth";
import { SESSION_COOKIE, verifyToken } from "./session";
import * as users from "./users";
import type { User } from "./users";

export type ViewerRole = "anon" | "user" | "admin";

export interface Viewer {
  user?: User;
  role: ViewerRole;
  /** Names of the user's groups. */
  groups: string[];
  permissions: Permission[];
  /** The session row behind the cookie (none for proxy sign-in). */
  sessionId?: string;
}

const ANON: Viewer = { role: "anon", groups: [], permissions: [] };

function viewerFor(user: User, sessionId?: string): Viewer {
  const groups = groupsOf(user.id);
  const permissions =
    user.role === "admin"
      ? [...PERMISSIONS]
      : [...new Set([...loadConfig().settings.auth.userPermissions, ...groups.flatMap((g) => g.permissions)])];
  return { user, role: user.role, groups: groups.map((g) => g.name), permissions, sessionId };
}

let bootstrapped = false;

/** v2 compatibility: with no users yet, HOMEPAGE_ADMIN_PASSWORD becomes an "admin" account. */
export async function ensureBootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;
  const pw = process.env.HOMEPAGE_ADMIN_PASSWORD;
  if (!pw || users.countUsers() > 0) return;
  const passwordHash = await hashPassword(pw);
  try {
    // Re-check after the (slow) hash: another request may have bootstrapped meanwhile.
    if (users.countUsers() > 0) return;
    users.createUser({ username: "admin", role: "admin", passwordHash });
    users.audit("system", "bootstrap-admin");
  } catch {
    // lost a race with a concurrent bootstrap: the account exists
  }
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Forward-auth: trust identity headers only when the proxy also sent the shared secret. */
function proxyUser(h: Headers): User | undefined {
  const { proxy, defaultRole } = loadConfig().settings.auth;
  if (!proxy.enabled || !proxy.secret) return undefined;
  const secret = h.get(proxy.secretHeader);
  const username = h.get(proxy.userHeader)?.trim();
  if (!secret || !safeEqual(secret, proxy.secret) || !username) return undefined;
  const email = h.get(proxy.emailHeader)?.trim() || undefined;
  const groups = h.get(proxy.groupsHeader)?.split(",").map((g) => g.trim()).filter(Boolean);
  const result = resolveIdentity(
    {
      provider: "proxy",
      subject: username,
      username,
      email,
      emailVerified: !!email,
      name: h.get(proxy.nameHeader)?.trim() || undefined,
      groups,
    },
    { signup: proxy.signup, defaultRole, adminGroup: proxy.adminGroup, trustUsername: true },
  );
  if (!result.ok) return undefined;
  syncSsoGroups(result.user.id, groups);
  return result.user;
}

/**
 * Who is making this request: the session cookie (whose row must still exist: sessions can be
 * revoked), then proxy headers.
 */
export async function viewer(): Promise<Viewer> {
  await ensureBootstrap();
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const claims = await verifyToken(token);
    const sid = claims?.kind === "session" && typeof claims.sid === "string" ? claims.sid : undefined;
    let user = sid && checkSession(sid, Number(claims!.sub)) ? users.getUser(Number(claims!.sub)) : undefined;
    if (user && !user.disabled) return viewerFor(user, sid);
    user = proxyUser(await headers());
    if (user && !user.disabled) return viewerFor(user);
  } catch {
    // no request context (e.g. build) or no database
  }
  return ANON;
}

/**
 * Can this viewer see an item with this visibility? Group lists match any of the viewer's groups
 * (case-insensitive). With publicView off, anonymous viewers see nothing.
 */
export function canSee(
  who: ViewerRole | Pick<Viewer, "role" | "groups">,
  visible: Visibility | undefined,
  publicView = loadConfig().settings.auth.publicView,
) {
  const { role, groups } = typeof who === "string" ? { role: who, groups: [] as string[] } : who;
  if (role === "admin") return true;
  if (role === "anon" && !publicView) return false;
  const v = visible ?? "public";
  if (Array.isArray(v)) {
    const mine = new Set(groups.map((g) => g.toLowerCase()));
    return role !== "anon" && v.some((g) => mine.has(g.toLowerCase()));
  }
  return v === "public" || (v === "users" && role === "user");
}

/** A visibility check bound to the current viewer, for sanitize() and findService(). */
export async function seeFilter(): Promise<(v: Visibility) => boolean> {
  const who = await viewer();
  const { publicView } = loadConfig().settings.auth;
  return (v) => canSee(who, v, publicView);
}

/** The signed-in user, when they have this permission. */
export async function requirePermission(p: Permission): Promise<User | null> {
  const v = await viewer();
  return v.user && v.permissions.includes(p) ? v.user : null;
}

/** Any signed-in, enabled user. */
export async function requireUser(): Promise<User | null> {
  return (await viewer()).user ?? null;
}

export async function requireAdmin(): Promise<User | null> {
  const v = await viewer();
  return v.role === "admin" ? v.user! : null;
}

export async function canEdit(): Promise<boolean> {
  return loadConfig().settings.editing && (await viewer()).role === "admin";
}

/** Reject cross-site state changes: the Origin (when a browser sends one) must match the host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Public origin for building absolute URLs (OAuth redirects). */
export function publicOrigin(req: Request): string {
  const base = loadConfig().settings.auth.baseUrl;
  if (base) return base.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${proto}://${host}`;
}

export interface ClientAuth {
  user: {
    id: number;
    username: string;
    name: string | null;
    role: "admin" | "user";
    avatar: string | null;
    hasPassword: boolean;
    twoFactor: boolean;
    groups: string[];
    permissions: Permission[];
  } | null;
  needsSetup: boolean;
  editingEnabled: boolean;
  canEdit: boolean;
  publicView: boolean;
  methods: { local: boolean; ldap: boolean; providers: { id: string; label: string; type: string }[] };
}

export async function clientAuth(): Promise<ClientAuth> {
  const { settings } = loadConfig();
  const v = await viewer();
  let needsSetup = false;
  try {
    needsSetup = users.countUsers() === 0;
  } catch {}
  return {
    user: v.user
      ? {
          id: v.user.id,
          username: v.user.username,
          name: v.user.name,
          role: v.user.role,
          avatar: v.user.avatar,
          hasPassword: v.user.hasPassword,
          twoFactor: v.user.twoFactor,
          groups: v.groups,
          permissions: v.permissions,
        }
      : null,
    needsSetup,
    editingEnabled: settings.editing,
    canEdit: settings.editing && v.role === "admin",
    publicView: settings.auth.publicView,
    methods: {
      local: settings.auth.local.enabled,
      ldap: settings.auth.ldap.enabled,
      providers: settings.auth.providers.map((p) => ({ id: p.id, label: providerLabel(p), type: p.type })),
    },
  };
}
