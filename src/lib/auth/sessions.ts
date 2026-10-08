import crypto from "node:crypto";
import type { NextResponse } from "next/server";
import { db } from "../db";
import { clientIp } from "./ratelimit";
import { cookieOptions, isHttps, SESSION_COOKIE, SESSION_DAYS, sessionToken } from "./session";

/**
 * Sign-ins are rows here as well as signed cookies, so they can be listed and revoked (sign out
 * other devices, an admin signing someone out, a password change). The cookie names its row.
 */

const DAY = 86_400_000;
/** "Remember me" off: the session ends 12 hours after it was last used. */
export const SHORT_MS = 12 * 3_600_000;
const TOUCH_EVERY = 5 * 60_000;

export interface SessionRow {
  id: string;
  user_id: number;
  created_at: number;
  last_seen: number;
  expires_at: number;
  ip: string | null;
  user_agent: string | null;
  method: string | null;
}

const remembered = (s: Pick<SessionRow, "created_at" | "expires_at">) => s.expires_at - s.created_at > SHORT_MS;

export function createSession(userId: number, info: { ip?: string; userAgent?: string; method: string; remember: boolean }): SessionRow {
  const now = Date.now();
  const row: SessionRow = {
    id: crypto.randomBytes(18).toString("base64url"),
    user_id: userId,
    created_at: now,
    last_seen: now,
    expires_at: now + (info.remember ? SESSION_DAYS * DAY : SHORT_MS),
    ip: info.ip ?? null,
    user_agent: info.userAgent?.slice(0, 300) ?? null,
    method: info.method,
  };
  db()
    .prepare("INSERT INTO sessions (id, user_id, created_at, last_seen, expires_at, ip, user_agent, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.user_id, row.created_at, row.last_seen, row.expires_at, row.ip, row.user_agent, row.method);
  return row;
}

/** Is this session alive and the user's? Short sessions slide forward as they are used. */
export function checkSession(id: string, userId: number): boolean {
  const s = db().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  const now = Date.now();
  if (!s || s.user_id !== userId || s.expires_at < now) return false;
  if (now - s.last_seen > TOUCH_EVERY) {
    const expires = remembered(s) ? s.expires_at : now + SHORT_MS;
    db().prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?").run(now, expires, id);
  }
  return true;
}

export const listSessions = (userId: number) =>
  db().prepare("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC").all(userId, Date.now()) as unknown as SessionRow[];

export const revokeSession = (id: string, userId: number) => db().prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;

/** Sign a user out everywhere, or everywhere but `keep`. */
export const revokeUserSessions = (userId: number, keep?: string) =>
  db().prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, keep ?? "").changes;

export const pruneSessions = () => db().prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());

/** Create a session and set its cookie on the response. */
export async function startSession(res: NextResponse, req: Request, userId: number, method: string, remember = true) {
  const s = createSession(userId, { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? undefined, method, remember });
  const options = cookieOptions(isHttps(req));
  // Without "remember me" the cookie lasts until the browser closes (and the row for 12 idle hours).
  res.cookies.set(SESSION_COOKIE, await sessionToken(userId, s.id), remember ? options : { ...options, maxAge: undefined });
  return s;
}

// --- password reset links (also invitations: a new account without a password) ---

const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const RESET_HOURS = 48;

/** A one-time token for a user to set their password; only its hash is stored. */
export function createResetToken(userId: number, by: string): string {
  const token = crypto.randomBytes(24).toString("base64url");
  db().prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?").run(userId, Date.now());
  db().prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)").run(hashToken(token), userId, Date.now() + RESET_HOURS * 3_600_000, by);
  return token;
}

/** The user a valid token belongs to; `consume` deletes it. */
export function resetTokenUser(token: string, consume = false): number | undefined {
  const row = db().prepare("SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?").get(hashToken(token)) as { user_id: number; expires_at: number } | undefined;
  if (!row || row.expires_at < Date.now()) return undefined;
  if (consume) db().prepare("DELETE FROM password_resets WHERE token_hash = ?").run(hashToken(token));
  return row.user_id;
}
