import { verifyToken } from "@/lib/auth/tokens";
import { collectMetrics } from "@/lib/export/prometheus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Prometheus scrape endpoint. Needs an API token (Settings → Monitoring & alerts → API tokens) as
 * `Authorization: Bearer page_…` (in prometheus.yml: authorization: { credentials: page_… }).
 */
export async function GET(req: Request) {
  if (!verifyToken(req.headers.get("authorization"))) {
    return new Response("Unauthorized: send an API token as Authorization: Bearer page_…\n", { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="page"' } });
  }
  return new Response(await collectMetrics(), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" } });
}
