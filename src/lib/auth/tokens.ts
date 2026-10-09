import crypto from "node:crypto";
import { db } from "../db";

/**
 * API tokens for machines (Prometheus scraping /api/export/metrics). Only a SHA-256 hash is
 * stored; the token itself is shown once, when it's made. Tokens belong to an admin and stop
 * working when that account is disabled, demoted or deleted.
 */
export interface ApiToken {
  id: number;
  name: string;
  /** The first characters, to tell tokens apart. */
  prefix: string;
  created_at: number;
  last_used: number | null;
  owner: string;
}

let ready = false;
function init() {
  if (ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used INTEGER
    );
  `);
  ready = true;
}

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function createToken(userId: number, name: string): { token: string; list: ApiToken[] } {
  init();
  const label = name.trim().slice(0, 60);
  if (!label) throw new Error("Give the token a name, e.g. Prometheus");
  const token = `page_${crypto.randomBytes(24).toString("base64url")}`;
  db().prepare("INSERT INTO api_tokens (user_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)").run(userId, label, hash(token), token.slice(0, 10), Date.now());
  return { token, list: listTokens() };
}

export function listTokens(): ApiToken[] {
  init();
  return db()
    .prepare("SELECT t.id, t.name, t.prefix, t.created_at, t.last_used, COALESCE(u.name, u.username) AS owner FROM api_tokens t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC")
    .all() as unknown as ApiToken[];
}

export function revokeToken(id: number): ApiToken[] {
  init();
  db().prepare("DELETE FROM api_tokens WHERE id = ?").run(id);
  return listTokens();
}

/** The admin a bearer token belongs to (and note its use), or undefined. */
export function verifyToken(header: string | null): { userId: number; username: string } | undefined {
  init();
  const m = /^Bearer\s+(page_[\w-]{20,})$/i.exec(header?.trim() ?? "");
  if (!m) return undefined;
  const row = db()
    .prepare("SELECT t.id, u.id AS userId, u.username FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND u.disabled = 0 AND u.role = 'admin'")
    .get(hash(m[1])) as { id: number; userId: number; username: string } | undefined;
  if (!row) return undefined;
  db().prepare("UPDATE api_tokens SET last_used = ? WHERE id = ?").run(Date.now(), row.id);
  return { userId: row.userId, username: row.username };
}
