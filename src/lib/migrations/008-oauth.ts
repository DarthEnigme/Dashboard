import type { DatabaseSync } from "node:sqlite";

/**
 * Schema step 8: NanoDash as an OAuth authorization server for MCP clients (claude.ai's custom
 * connectors). Clients register themselves; a person approves one, and it trades the one-time code
 * for a `tasks` API token (api_tokens), revoked like any other.
 */
export function oauth(d: DatabaseSync) {
  d.exec(`
    -- Dynamic client registration (RFC 7591). Public clients only: PKCE stands in for a secret.
    CREATE TABLE oauth_clients (
      client_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      -- JSON list of the exact URIs a code may be sent to.
      redirect_uris TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      -- When a person last approved it (NULL: never; such clients are pruned after a day).
      last_used INTEGER
    );
    -- Authorization codes: hashed, short-lived, used once.
    CREATE TABLE oauth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      redirect_uri TEXT NOT NULL,
      -- PKCE S256 challenge.
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    -- Which client a token was issued to, so it can be named and revoked with it.
    ALTER TABLE api_tokens ADD COLUMN client_id TEXT;
  `);
}
