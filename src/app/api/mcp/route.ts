import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { publicOrigin } from "@/lib/auth";
import { verifyToken } from "@/lib/auth/tokens";
import { loadConfig } from "@/lib/config/load";
import { tasksServer } from "@/lib/mcp/tasks-tools";
import { CORS } from "@/lib/oauth/http";
import { endpoints, SCOPE } from "@/lib/oauth/server";
import { buildInfo } from "@/lib/version";
import { names } from "../tasks/_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Browser-based MCP clients may call this directly: the bearer token is the only credential, no cookies. */
const HEADERS = { ...CORS, "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID", "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id" };
const withCors = (res: Response) => {
  for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);
  return res;
};

/**
 * No token, or one that can't reach the task boards. The header points to the OAuth discovery
 * document (RFC 9728), which is how claude.ai finds where to sign in; a pasted token works too.
 */
function unauthorized(req: Request): Response {
  const meta = endpoints(publicOrigin(req)).resourceMetadata;
  return withCors(
    Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: sign in with OAuth, or send a tasks API token as Authorization: Bearer page_…" }, id: null },
      { status: 401, headers: { "WWW-Authenticate": `Bearer realm="page", resource_metadata="${meta}", scope="${SCOPE}"` } },
    ),
  );
}

/**
 * The Tasks app as an MCP server (Streamable HTTP, stateless): Claude Code, claude.ai or any MCP
 * client manages the token owner's task boards. Each POST carries the bearer token, gets a fresh
 * server bound to that person, and a JSON answer.
 */
export async function POST(req: Request) {
  const who = verifyToken(req.headers.get("authorization"), "tasks");
  if (!who) return unauthorized(req);
  const server = tasksServer(who.userId, { names: await names(), dueSoonDays: loadConfig().settings.tasks.dueSoonDays, version: buildInfo().version });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } finally {
    void server.close();
  }
}

/** Stateless: no stream to open (GET) and no session to end (DELETE). */
const notAllowed = (req: Request) =>
  verifyToken(req.headers.get("authorization"), "tasks")
    ? withCors(Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, { status: 405, headers: { Allow: "POST" } }))
    : unauthorized(req);

export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = () => new Response(null, { status: 204, headers: HEADERS });
