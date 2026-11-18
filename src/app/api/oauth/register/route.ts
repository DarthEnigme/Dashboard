import { audit } from "@/lib/auth/users";
import { oauthError, oauthJson, preflight } from "@/lib/oauth/http";
import { OAuthError, registerClient } from "@/lib/oauth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** RFC 7591 dynamic client registration: any app may register; a person still has to approve it. */
export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 16_384) return oauthError("invalid_client_metadata", "Too large");
  let meta: unknown;
  try {
    meta = JSON.parse(text);
  } catch {
    return oauthError("invalid_client_metadata", "Send the client's metadata as JSON");
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return oauthError("invalid_client_metadata", "Send the client's metadata as a JSON object");
  try {
    const client = registerClient(meta as Record<string, unknown>);
    audit("system", "oauth-register", { client: client.client_name, redirect: client.redirect_uris.map((u) => new URL(u).host) });
    return oauthJson(client, 201);
  } catch (e) {
    if (e instanceof OAuthError) return oauthError(e.code, e.message, e.code === "temporarily_unavailable" ? 503 : 400);
    throw e;
  }
}

export const OPTIONS = preflight;
