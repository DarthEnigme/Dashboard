import crypto from "node:crypto";
import { db } from "../db";
import { createToken } from "../auth/tokens";
import { msg } from "@/i18n";

/**
 * NanoDash as a small OAuth 2.1 authorization server, for MCP clients that can't take a pasted
 * token (claude.ai's custom connectors). It does only what MCP needs:
 * - dynamic client registration (RFC 7591), public clients only;
 * - the authorization code flow with PKCE (S256 only), approved by a signed-in person;
 * - a token endpoint that trades a code for a `tasks` API token: long-lived, listed with the
 *   others and revoked the same way (no refresh tokens).
 * Everything here is pure database work; the routes add HTTP.
 */

export const SCOPE = "tasks";
/** How long a code is good for. */
const CODE_TTL = 10 * 60_000;
/** Clients nobody ever approved are dropped after this long. */
const UNUSED_CLIENT_TTL = 24 * 3_600_000;
const MAX_CLIENTS = 500;
const MAX_REDIRECTS = 10;

export class OAuthError extends Error {
  constructor(
    /** RFC 6749 error code, e.g. invalid_request, invalid_grant. */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const oops = (code: string, message: string): never => {
  throw new OAuthError(code, message);
};

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest();
const hashHex = (v: string) => sha256(v).toString("hex");

// ---------- URLs ----------

export const endpoints = (origin: string) => ({
  issuer: origin,
  resource: `${origin}/api/mcp`,
  authorize: `${origin}/oauth/authorize`,
  token: `${origin}/api/oauth/token`,
  register: `${origin}/api/oauth/register`,
  resourceMetadata: `${origin}/.well-known/oauth-protected-resource/api/mcp`,
});

/** RFC 9728: what /api/mcp is and who issues tokens for it. */
export const protectedResourceMetadata = (origin: string) => {
  const e = endpoints(origin);
  return { resource: e.resource, authorization_servers: [e.issuer], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "NanoDash tasks" };
};

/** RFC 8414: how to register, authorize and get a token. */
export const authorizationServerMetadata = (origin: string) => {
  const e = endpoints(origin);
  return {
    issuer: e.issuer,
    authorization_endpoint: e.authorize,
    token_endpoint: e.token,
    registration_endpoint: e.register,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
};

// ---------- clients ----------

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLoopback = (u: URL) => u.protocol === "http:" && LOOPBACK.has(u.hostname);
/** Schemes a code must never be sent to (they'd run or read something in the browser). */
const BAD_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:"]);

/** A redirect URI a client may register: https, http to this machine (a desktop app), or an app's own scheme. No fragment. */
function checkRedirect(v: unknown): string {
  if (typeof v !== "string" || v.length > 2000) oops("invalid_redirect_uri", "A redirect URI must be a URL");
  let u: URL;
  try {
    u = new URL(v as string);
  } catch {
    return oops("invalid_redirect_uri", `Not a URL: ${v}`);
  }
  if (u.hash) oops("invalid_redirect_uri", "A redirect URI can't have a fragment");
  if (BAD_SCHEMES.has(u.protocol)) oops("invalid_redirect_uri", `Not allowed: ${u.protocol}`);
  if (u.protocol === "http:" && !isLoopback(u)) oops("invalid_redirect_uri", "Plain http is only allowed to localhost");
  return v as string;
}

export interface Client {
  client_id: string;
  name: string;
  redirect_uris: string[];
}

/** The fields RFC 7591 answers with. */
export const clientInfo = (c: Client & { created_at?: number }) => ({
  client_id: c.client_id,
  client_id_issued_at: Math.floor((c.created_at ?? Date.now()) / 1000),
  client_name: c.name,
  redirect_uris: c.redirect_uris,
  grant_types: ["authorization_code"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  scope: SCOPE,
});

/** Register a client from its RFC 7591 metadata. Only public clients: whatever auth method is asked for, it gets "none". */
export function registerClient(meta: Record<string, unknown>, now = Date.now()): ReturnType<typeof clientInfo> {
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || !uris.length) oops("invalid_redirect_uri", "redirect_uris is required");
  if ((uris as unknown[]).length > MAX_REDIRECTS) oops("invalid_client_metadata", `Up to ${MAX_REDIRECTS} redirect URIs`);
  const redirect_uris = [...new Set((uris as unknown[]).map(checkRedirect))];
  const grants = meta.grant_types;
  if (Array.isArray(grants) && !grants.includes("authorization_code")) oops("invalid_client_metadata", "Only the authorization_code grant is supported");
  const name = (typeof meta.client_name === "string" ? meta.client_name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) : "") || "MCP client";

  db().prepare("DELETE FROM oauth_clients WHERE last_used IS NULL AND created_at < ?").run(now - UNUSED_CLIENT_TTL);
  const { n } = db().prepare("SELECT COUNT(*) AS n FROM oauth_clients").get() as { n: number };
  if (n >= MAX_CLIENTS) oops("temporarily_unavailable", "Too many registered clients; try again tomorrow");

  const client: Client = { client_id: `mcp_${crypto.randomBytes(16).toString("base64url")}`, name, redirect_uris };
  db().prepare("INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)").run(client.client_id, name, JSON.stringify(redirect_uris), now);
  return clientInfo({ ...client, created_at: now });
}

export function getClient(clientId: unknown): Client | undefined {
  if (typeof clientId !== "string" || !clientId) return undefined;
  const row = db().prepare("SELECT client_id, name, redirect_uris FROM oauth_clients WHERE client_id = ?").get(clientId) as { client_id: string; name: string; redirect_uris: string } | undefined;
  return row && { ...row, redirect_uris: JSON.parse(row.redirect_uris) as string[] };
}

/** Is `uri` one the client registered? Exact match, except a loopback URI's port, which a desktop app picks each time (RFC 8252 §7.3). */
export function redirectAllowed(client: Client, uri: string): boolean {
  if (client.redirect_uris.includes(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (!isLoopback(u)) return false;
  return client.redirect_uris.some((r) => {
    const reg = new URL(r);
    if (!isLoopback(reg)) return false;
    reg.port = u.port;
    return reg.href === u.href;
  });
}

// ---------- the authorization request ----------

export interface AuthorizeRequest {
  client: Client;
  redirectUri: string;
  state?: string;
  challenge: string;
}

/**
 * Check an authorization request's parameters. Errors come in two kinds, as RFC 6749 §4.1.2.1 asks:
 * `fatal` ones (unknown client, wrong redirect URI) must be shown to the person, never redirected;
 * the others go back to the client's redirect URI.
 */
export function checkAuthorize(p: Record<string, string | undefined>, origin: string): { ok: AuthorizeRequest } | { fatal: string } | { redirect: string } {
  const client = getClient(p.client_id);
  if (!client) return { fatal: msg("This app isn't registered with NanoDash (unknown client_id). Connect it again from the app.") };
  const redirectUri = p.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
  if (!redirectUri || !redirectAllowed(client, redirectUri)) return { fatal: msg("The app asked to send the answer to an address it didn't register (redirect_uri).") };
  const back = (error: string, description: string) => ({ redirect: errorRedirect(redirectUri, error, description, p.state, origin) });
  if (p.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
  if (!p.code_challenge || !/^[\w-]{43,128}$/.test(p.code_challenge)) return back("invalid_request", "PKCE is required: send code_challenge");
  if (p.code_challenge_method !== "S256") return back("invalid_request", "Only code_challenge_method=S256 is supported");
  if (p.scope && !p.scope.split(" ").every((s) => s === SCOPE || s === "")) return back("invalid_scope", `The only scope is ${SCOPE}`);
  if (p.resource && p.resource.replace(/\/+$/, "") !== endpoints(origin).resource) return back("invalid_target", `Tokens are for ${endpoints(origin).resource}`);
  return { ok: { client, redirectUri, state: p.state, challenge: p.code_challenge } };
}

const withParams = (uri: string, params: Record<string, string | undefined>) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.href;
};

export const errorRedirect = (redirectUri: string, error: string, description: string, state: string | undefined, origin: string) =>
  withParams(redirectUri, { error, error_description: description, state, iss: origin });

/** The person said yes: a one-time code for the client, sent back to its redirect URI. */
export function approve(req: AuthorizeRequest, userId: number, origin: string, now = Date.now()): string {
  const code = crypto.randomBytes(32).toString("base64url");
  db().prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(now);
  db()
    .prepare("INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(hashHex(code), req.client.client_id, userId, req.redirectUri, req.challenge, now + CODE_TTL);
  db().prepare("UPDATE oauth_clients SET last_used = ? WHERE client_id = ?").run(now, req.client.client_id);
  return withParams(req.redirectUri, { code, state: req.state, iss: origin });
}

export const deny = (req: AuthorizeRequest, origin: string) => errorRedirect(req.redirectUri, "access_denied", "The request was declined", req.state, origin);

// ---------- the token request ----------

/**
 * grant_type=authorization_code: the code (once, before it expires), from the client it was issued to,
 * with the same redirect URI and the PKCE verifier. Answers a `tasks` token for the person who approved.
 */
export function redeem(p: Record<string, string | undefined>, now = Date.now()) {
  if (p.grant_type !== "authorization_code") oops("unsupported_grant_type", "Only grant_type=authorization_code is supported");
  if (!p.code || !p.code_verifier) oops("invalid_request", "code and code_verifier are required");
  const row = db()
    .prepare("SELECT c.client_id, c.user_id, c.redirect_uri, c.challenge, c.expires_at, o.name FROM oauth_codes c JOIN oauth_clients o ON o.client_id = c.client_id WHERE c.code_hash = ?")
    .get(hashHex(p.code!)) as { client_id: string; user_id: number; redirect_uri: string; challenge: string; expires_at: number; name: string } | undefined;
  // Used once, whatever happens next.
  db().prepare("DELETE FROM oauth_codes WHERE code_hash = ?").run(hashHex(p.code!));
  if (!row || row.expires_at < now) oops("invalid_grant", "The code is unknown, used or expired");
  if (p.client_id && p.client_id !== row!.client_id) oops("invalid_grant", "The code was issued to another client");
  if (p.redirect_uri !== undefined && p.redirect_uri !== row!.redirect_uri) oops("invalid_grant", "redirect_uri doesn't match the authorization request");
  const expected = Buffer.from(row!.challenge);
  const got = Buffer.from(sha256(p.code_verifier!).toString("base64url"));
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) oops("invalid_grant", "The code_verifier doesn't match the code_challenge");
  const { token } = createToken(row!.user_id, row!.name, SCOPE, row!.client_id);
  return { access_token: token, token_type: "Bearer", scope: SCOPE };
}
