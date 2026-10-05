import * as oidc from "openid-client";
import type { ProviderConfig } from "../config/schema";
import type { ExternalIdentity } from "./identity";
import { signToken, verifyToken } from "./session";

export const STATE_COOKIE = "page_oauth";

const GOOGLE_ISSUER = "https://accounts.google.com";

export const providerLabel = (p: ProviderConfig) =>
  p.name ?? (p.type === "google" ? "Google" : p.type === "github" ? "GitHub" : p.id);

const configs = new Map<string, Promise<oidc.Configuration>>();

/** Discovery result per provider, cached; http issuers are allowed for local test IdPs. */
function oidcConfig(p: ProviderConfig): Promise<oidc.Configuration> {
  const issuer = p.type === "google" ? GOOGLE_ISSUER : p.issuer;
  if (!issuer) throw new Error(`Provider "${p.id}" needs an issuer URL`);
  const key = `${p.id}|${issuer}|${p.clientId}`;
  let c = configs.get(key);
  if (!c) {
    const url = new URL(issuer);
    c = oidc.discovery(url, p.clientId, p.clientSecret, undefined, url.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : undefined);
    c.catch(() => configs.delete(key));
    configs.set(key, c);
  }
  return c;
}

export const redirectUri = (origin: string, p: ProviderConfig) => `${origin}/api/auth/oauth/${p.id}/callback`;

/** Build the provider's authorize URL plus a signed, short-lived cookie holding state/nonce/PKCE. */
export async function startLogin(p: ProviderConfig, origin: string): Promise<{ url: string; cookie: string }> {
  const state = oidc.randomState();
  const redirect_uri = redirectUri(origin, p);

  if (p.type === "github") {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({ client_id: p.clientId, redirect_uri, scope: p.scopes ?? "read:user user:email", state }).toString();
    return { url: url.toString(), cookie: await signToken({ state }, p.id, "10m") };
  }

  const config = await oidcConfig(p);
  const verifier = oidc.randomPKCECodeVerifier();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri,
    scope: p.scopes ?? "openid email profile",
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
  });
  return { url: url.toString(), cookie: await signToken({ state, nonce, verifier }, p.id, "10m") };
}

/** Finish the login: check state, exchange the code and return who this is. */
export async function finishLogin(p: ProviderConfig, origin: string, currentUrl: URL, cookie: string | undefined): Promise<ExternalIdentity> {
  const saved = await verifyToken(cookie);
  if (!saved || saved.sub !== p.id) throw new Error("Login session expired. Please try again.");
  const error = currentUrl.searchParams.get("error");
  if (error) throw new Error(currentUrl.searchParams.get("error_description") ?? error);

  if (p.type === "github") return githubIdentity(p, origin, currentUrl, String(saved.state));

  const config = await oidcConfig(p);
  // Rebuild the callback URL on the public origin so it matches the registered redirect URI.
  const callback = new URL(redirectUri(origin, p));
  callback.search = currentUrl.search;
  const tokens = await oidc.authorizationCodeGrant(config, callback, {
    pkceCodeVerifier: String(saved.verifier),
    expectedState: String(saved.state),
    expectedNonce: String(saved.nonce),
  });
  const claims = tokens.claims();
  if (!claims) throw new Error("The provider returned no ID token");
  let info: Record<string, unknown> = claims;
  if (!claims.email && tokens.access_token) {
    info = { ...(await oidc.fetchUserInfo(config, tokens.access_token, claims.sub)), ...claims };
  }
  const groups = info[p.groupsClaim];
  return {
    provider: p.id,
    subject: String(claims.sub),
    username: (info.preferred_username as string | undefined) ?? undefined,
    email: info.email as string | undefined,
    emailVerified: info.email_verified === true || (p.trustEmail && !!info.email),
    name: info.name as string | undefined,
    groups: Array.isArray(groups) ? groups.map(String) : typeof groups === "string" ? [groups] : [],
  };
}

async function githubIdentity(p: ProviderConfig, origin: string, url: URL, expectedState: string): Promise<ExternalIdentity> {
  if (url.searchParams.get("state") !== expectedState) throw new Error("State mismatch. Please try again.");
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code: url.searchParams.get("code"),
      redirect_uri: redirectUri(origin, p),
    }),
  });
  const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!token.access_token) throw new Error(token.error_description ?? "GitHub login failed");
  const gh = (path: string) =>
    fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "Page" },
    }).then((r) => r.json());
  const [user, emails] = (await Promise.all([gh("/user"), gh("/user/emails")])) as [
    { id: number; login: string; name?: string },
    { email: string; primary: boolean; verified: boolean }[],
  ];
  const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : undefined;
  return {
    provider: p.id,
    subject: String(user.id),
    username: user.login,
    email: primary?.email,
    emailVerified: !!primary,
    name: user.name ?? undefined,
    groups: [],
  };
}
