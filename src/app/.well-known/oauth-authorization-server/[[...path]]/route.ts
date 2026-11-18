import { publicOrigin } from "@/lib/auth";
import { oauthJson, preflight } from "@/lib/oauth/http";
import { authorizationServerMetadata } from "@/lib/oauth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** RFC 8414: the authorization server's endpoints and what it supports. */
export const GET = (req: Request) => oauthJson(authorizationServerMetadata(publicOrigin(req)));
export const OPTIONS = preflight;
