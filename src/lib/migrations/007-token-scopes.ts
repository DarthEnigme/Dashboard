import type { DatabaseSync } from "node:sqlite";
import { addColumn } from "./addColumn";

/**
 * Schema step 7: API tokens get a scope. The table used to be made on first use, so it may be
 * missing: make it, then add the column to one that already exists.
 */
export function tokenScopes(d: DatabaseSync) {
  d.exec(`
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
  // metrics: read /api/export/metrics (admins only). tasks: the owner's task boards, over /api/mcp.
  addColumn(d, "api_tokens", "scope TEXT NOT NULL DEFAULT 'metrics'");
}
