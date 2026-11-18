import { publicOrigin } from "@/lib/auth";
import { oauthJson, preflight } from "@/lib/oauth/http";
import { protectedResourceMetadata } from "@/lib/oauth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** RFC 9728, at the root and at /.well-known/oauth-protected-resource/api/mcp: where /api/mcp's tokens come from. */
export const GET = (req: Request) => oauthJson(protectedResourceMetadata(publicOrigin(req)));
export const OPTIONS = preflight;
