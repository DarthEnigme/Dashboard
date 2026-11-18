import crypto from "node:crypto";
import { db } from "../db";
import { permissionsOf } from "./index";

/**
 * API tokens for machines. Only a SHA-256 hash is stored; the token itself is shown once, when
 * it's made. Each token has a scope:
 * - `metrics`: Prometheus scraping /api/export/metrics. Belongs to an admin, and stops working when
 *   that account is disabled, demoted or deleted.
 * - `tasks`: Claude (or any MCP client) managing its owner's task boards over /api/mcp. Any person
 *   with the `tasks` permission can make one, and it stops working when they lose it.
 */
export const TOKEN_SCOPES = ["metrics", "tasks"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export interface ApiToken {
  id: number;
  name: string;
  /** The first characters, to tell tokens apart. */
  prefix: string;
  scope: TokenScope;
  created_at: number;
  last_used: number | null;
  owner: string;
}

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export const isScope = (v: unknown): v is TokenScope => (TOKEN_SCOPES as readonly unknown[]).includes(v);

/** A new token for `userId`; `clientId` is the OAuth client it was issued to, if any. */
export function createToken(userId: number, name: string, scope: TokenScope = "metrics", clientId?: string): { token: string; list: ApiToken[] } {
  const label = name.trim().slice(0, 60);
  if (!label) throw new Error("Give the token a name, e.g. Prometheus");
  if (!isScope(scope)) throw new Error("Unknown token scope");
  const token = `page_${crypto.randomBytes(24).toString("base64url")}`;
  db()
    .prepare("INSERT INTO api_tokens (user_id, name, token_hash, prefix, scope, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(userId, label, hash(token), token.slice(0, 10), scope, clientId ?? null, Date.now());
  return { token, list: listTokens() };
}

/** Every token, or only one person's (`userId`), newest first. */
export function listTokens(userId?: number): ApiToken[] {
  const mine = userId === undefined ? "" : "WHERE t.user_id = ?";
  return db()
    .prepare(`SELECT t.id, t.name, t.prefix, t.scope, t.created_at, t.last_used, COALESCE(u.name, u.username) AS owner FROM api_tokens t JOIN users u ON u.id = t.user_id ${mine} ORDER BY t.created_at DESC, t.id DESC`)
    .all(...(userId === undefined ? [] : [userId])) as unknown as ApiToken[];
}

/** Revoke a token: any of them, or only one of `userId`'s. Answers the list as `listTokens(userId)` would. */
export function revokeToken(id: number, userId?: number): ApiToken[] {
  if (userId === undefined) db().prepare("DELETE FROM api_tokens WHERE id = ?").run(id);
  else db().prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").run(id, userId);
  return listTokens(userId);
}

/**
 * Who a bearer token of this scope belongs to (and note its use), or undefined: a metrics token
 * needs an enabled admin, a tasks token an enabled account with the `tasks` permission.
 */
export function verifyToken(header: string | null, scope: TokenScope): { userId: number; username: string } | undefined {
  const m = /^Bearer\s+(page_[\w-]{20,})$/i.exec(header?.trim() ?? "");
  if (!m) return undefined;
  const row = db()
    .prepare("SELECT t.id, u.id AS userId, u.username, u.role FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.scope = ? AND u.disabled = 0")
    .get(hash(m[1]), scope) as { id: number; userId: number; username: string; role: "admin" | "user" } | undefined;
  if (!row) return undefined;
  const allowed = scope === "metrics" ? row.role === "admin" : permissionsOf({ id: row.userId, role: row.role }).includes("tasks");
  if (!allowed) return undefined;
  db().prepare("UPDATE api_tokens SET last_used = ? WHERE id = ?").run(Date.now(), row.id);
  return { userId: row.userId, username: row.username };
}
