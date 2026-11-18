import { formParams, oauthError, oauthJson, preflight } from "@/lib/oauth/http";
import { OAuthError, redeem } from "@/lib/oauth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** grant_type=authorization_code with PKCE: the approved code for a `tasks` API token. */
export async function POST(req: Request) {
  try {
    return oauthJson(redeem(await formParams(req)));
  } catch (e) {
    if (e instanceof OAuthError) return oauthError(e.code, e.message);
    throw e;
  }
}

export const OPTIONS = preflight;
