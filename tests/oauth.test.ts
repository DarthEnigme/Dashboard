import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { CONFIG_DIR, invalidate } from "@/lib/config/load";
import { safeNext } from "@/lib/auth";
import { listTokens, revokeToken, verifyToken } from "@/lib/auth/tokens";
import { approve, authorizationServerMetadata, checkAuthorize, deny, protectedResourceMetadata, redeem, registerClient, type AuthorizeRequest } from "@/lib/oauth/server";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

const ORIGIN = "https://dash.example.com";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const settings = path.join(CONFIG_DIR, "settings.yaml");

beforeAll(() => {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(settings, `title: Test\nauth:\n  baseUrl: ${ORIGIN}\n  userPermissions: [tasks]\n`);
  invalidate();
});
afterAll(() => {
  fs.rmSync(settings, { force: true });
  invalidate();
});

let me = 0;
beforeEach(() => {
  db().exec("DELETE FROM oauth_clients; DELETE FROM api_tokens; DELETE FROM users;");
  me = Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES ('me', 'user', ?)").run(Date.now()).lastInsertRowid);
});

/** A PKCE pair, as a client makes it. */
function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}

function authorize(clientId: string, over: Record<string, string | undefined> = {}) {
  const { verifier, challenge } = pkce();
  const params = { client_id: clientId, redirect_uri: CLAUDE, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz", ...over };
  return { verifier, params, checked: checkAuthorize(params, ORIGIN) };
}

const ok = (c: ReturnType<typeof checkAuthorize>): AuthorizeRequest => {
  if (!("ok" in c)) throw new Error(JSON.stringify(c));
  return c.ok;
};
const codeOf = (url: string) => new URL(url).searchParams.get("code")!;

describe("discovery", () => {
  it("names /api/mcp as the resource and this site as its authorization server", () => {
    expect(protectedResourceMetadata(ORIGIN)).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN], scopes_supported: ["tasks"] });
    expect(authorizationServerMetadata(ORIGIN)).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
});

describe("client registration", () => {
  it("registers public clients with safe redirect URIs", () => {
    const c = registerClient({ client_name: "Claude\u0007", redirect_uris: [CLAUDE], token_endpoint_auth_method: "client_secret_basic" });
    expect(c).toMatchObject({ client_name: "Claude", redirect_uris: [CLAUDE], token_endpoint_auth_method: "none" });
    expect(c.client_id).toMatch(/^mcp_/);
    expect(registerClient({ redirect_uris: ["http://localhost:33418/callback"] }).client_name).toBe("MCP client");
    expect(registerClient({ redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback"] }).redirect_uris).toHaveLength(1);
  });

  it("refuses redirect URIs a code could leak through", () => {
    for (const uri of ["http://evil.example/cb", "javascript:alert(1)", "data:text/html,x", "https://x.example/cb#frag", "not a url"]) {
      expect(() => registerClient({ redirect_uris: [uri] }), uri).toThrow();
    }
    expect(() => registerClient({})).toThrow(/redirect_uris/);
    expect(() => registerClient({ redirect_uris: [CLAUDE], grant_types: ["client_credentials"] })).toThrow(/authorization_code/);
  });

  it("forgets clients nobody approved within a day", () => {
    registerClient({ redirect_uris: [CLAUDE] }, Date.now() - 2 * 86_400_000);
    registerClient({ redirect_uris: [CLAUDE] });
    expect((db().prepare("SELECT COUNT(*) AS n FROM oauth_clients").get() as { n: number }).n).toBe(1);
  });
});

describe("authorization request", () => {
  it("never redirects to an unknown client or an unregistered address", () => {
    const { client_id } = registerClient({ redirect_uris: [CLAUDE] });
    expect(authorize("mcp_nope").checked).toHaveProperty("fatal");
    expect(authorize(client_id, { redirect_uri: "https://evil.example/cb" }).checked).toHaveProperty("fatal");
  });

  it("sends protocol errors back to the client, with its state", () => {
    const { client_id } = registerClient({ redirect_uris: [CLAUDE] });
    const back = (over: Record<string, string | undefined>) => {
      const c = authorize(client_id, over).checked;
      if (!("redirect" in c)) throw new Error("expected a redirect");
      const u = new URL(c.redirect);
      return [u.origin + u.pathname, u.searchParams.get("error"), u.searchParams.get("state")];
    };
    expect(back({ code_challenge: undefined })).toEqual([CLAUDE, "invalid_request", "xyz"]);
    expect(back({ code_challenge_method: "plain" })).toEqual([CLAUDE, "invalid_request", "xyz"]);
    expect(back({ response_type: "token" })).toEqual([CLAUDE, "unsupported_response_type", "xyz"]);
    expect(back({ scope: "admin" })).toEqual([CLAUDE, "invalid_scope", "xyz"]);
    expect(back({ resource: "https://other.example/api/mcp" })).toEqual([CLAUDE, "invalid_target", "xyz"]);
    expect(ok(authorize(client_id, { scope: "tasks", resource: `${ORIGIN}/api/mcp` }).checked).redirectUri).toBe(CLAUDE);
  });

  it("lets a desktop app use any port on localhost", () => {
    const { client_id } = registerClient({ redirect_uris: ["http://127.0.0.1:5000/callback"] });
    expect(ok(authorize(client_id, { redirect_uri: "http://127.0.0.1:61234/callback" }).checked).redirectUri).toBe("http://127.0.0.1:61234/callback");
    expect(authorize(client_id, { redirect_uri: "http://127.0.0.1:61234/other" }).checked).toHaveProperty("fatal");
  });
});

describe("code for token", () => {
  it("trades an approved code once for a tasks token of the person who approved", () => {
    const { client_id } = registerClient({ client_name: "Claude", redirect_uris: [CLAUDE] });
    const { verifier, checked } = authorize(client_id);
    const back = new URL(approve(ok(checked), me, ORIGIN));
    expect(back.origin + back.pathname).toBe(CLAUDE);
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);
    const code = back.searchParams.get("code")!;

    const t = redeem({ grant_type: "authorization_code", code, code_verifier: verifier, client_id, redirect_uri: CLAUDE });
    expect(t).toMatchObject({ token_type: "Bearer", scope: "tasks" });
    expect(verifyToken(`Bearer ${t.access_token}`, "tasks")).toMatchObject({ userId: me });
    expect(verifyToken(`Bearer ${t.access_token}`, "metrics")).toBeUndefined();
    // Listed (named after the app) and revoked like any token.
    const [listed] = listTokens(me);
    expect(listed).toMatchObject({ name: "Claude", scope: "tasks" });
    // Used once.
    expect(() => redeem({ grant_type: "authorization_code", code, code_verifier: verifier, client_id })).toThrow(/used or expired/);
    revokeToken(listed.id, me);
    expect(verifyToken(`Bearer ${t.access_token}`, "tasks")).toBeUndefined();
  });

  it("refuses a code with the wrong verifier, client or redirect URI, and burns it", () => {
    const { client_id } = registerClient({ redirect_uris: [CLAUDE, "https://claude.ai/other"] });
    const other = registerClient({ redirect_uris: [CLAUDE] }).client_id;
    const attempt = (fields: Record<string, string>) => {
      const { verifier, checked } = authorize(client_id);
      const code = codeOf(approve(ok(checked), me, ORIGIN));
      expect(() => redeem({ grant_type: "authorization_code", code, code_verifier: verifier, client_id, ...fields })).toThrow();
      // The failed attempt used the code up: the right verifier no longer helps.
      expect(() => redeem({ grant_type: "authorization_code", code, code_verifier: verifier, client_id })).toThrow(/used or expired/);
    };
    attempt({ code_verifier: pkce().verifier });
    attempt({ client_id: other });
    attempt({ redirect_uri: "https://claude.ai/other" });
    expect(() => redeem({ grant_type: "password", code: "x", code_verifier: "y" })).toThrow(/authorization_code/);
    expect(listTokens()).toEqual([]);
  });

  it("lets a code expire after ten minutes", () => {
    const { client_id } = registerClient({ redirect_uris: [CLAUDE] });
    const { verifier, checked } = authorize(client_id);
    const code = codeOf(approve(ok(checked), me, ORIGIN, Date.now() - 11 * 60_000));
    expect(() => redeem({ grant_type: "authorization_code", code, code_verifier: verifier })).toThrow(/expired/);
  });

  it("tells the client when the person declines", () => {
    const { client_id } = registerClient({ redirect_uris: [CLAUDE] });
    const u = new URL(deny(ok(authorize(client_id).checked), ORIGIN));
    expect([u.searchParams.get("error"), u.searchParams.get("state"), u.searchParams.get("code")]).toEqual(["access_denied", "xyz", null]);
  });
});

describe("routes", () => {
  it("serves discovery, registration and the token endpoint over HTTP", async () => {
    const resource = await import("@/app/.well-known/oauth-protected-resource/[[...path]]/route");
    const server = await import("@/app/.well-known/oauth-authorization-server/[[...path]]/route");
    const register = await import("@/app/api/oauth/register/route");
    const token = await import("@/app/api/oauth/token/route");
    const mcp = await import("@/app/api/mcp/route");

    const res = await resource.GET(new Request("http://localhost/.well-known/oauth-protected-resource/api/mcp"));
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((await res.json()).resource).toBe(`${ORIGIN}/api/mcp`);
    expect((await (await server.GET(new Request("http://localhost/.well-known/oauth-authorization-server"))).json()).issuer).toBe(ORIGIN);

    const refused = await mcp.POST(new Request("http://localhost/api/mcp", { method: "POST", body: "{}" }));
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);

    const reg = await register.POST(new Request("http://localhost/api/oauth/register", { method: "POST", body: JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE] }) }));
    expect(reg.status).toBe(201);
    const { client_id } = await reg.json();
    expect((await register.POST(new Request("http://localhost/api/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example"] }) }))).status).toBe(400);

    const { verifier, checked } = authorize(client_id);
    const code = codeOf(approve(ok(checked), me, ORIGIN));
    const form = (body: Record<string, string>) =>
      token.POST(new Request("http://localhost/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }));
    const bad = await form({ grant_type: "authorization_code", code: "nope", code_verifier: verifier });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_grant");
    const good = await form({ grant_type: "authorization_code", code, code_verifier: verifier, client_id, redirect_uri: CLAUDE });
    expect(good.headers.get("cache-control")).toBe("no-store");
    const { access_token } = await good.json();

    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
    const served = await mcp.POST(
      new Request("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(init) }),
    );
    expect(served.status).toBe(200);
  });

  it("sends someone signed out to sign in before answering, and refuses other sites", async () => {
    const { POST } = await import("@/app/api/oauth/authorize/route");
    const { client_id } = registerClient({ redirect_uris: [CLAUDE] });
    const { params } = authorize(client_id);
    const body = new URLSearchParams({ ...(params as Record<string, string>), decision: "allow" });
    const post = (origin?: string) =>
      POST(new Request("http://localhost/api/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) }, body }));
    expect((await post("https://evil.example")).status).toBe(403);
    const res = await post();
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    const next = to.searchParams.get("next")!;
    expect(next).toMatch(/^\/oauth\/authorize\?/);
    expect(next).not.toContain("decision");
    expect(safeNext(next)).toBe(next);
  });
});

describe("safeNext", () => {
  it("keeps paths on this site and nothing else", () => {
    expect(safeNext("/tasks?x=1")).toBe("/tasks?x=1");
    for (const v of ["//evil.example", "/\\evil.example", "https://evil.example", "/\t/evil.example", "", undefined, 5]) expect(safeNext(v), String(v)).toBe("/");
  });
});
