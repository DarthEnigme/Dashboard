/**
 * HTTP for the OAuth endpoints. Discovery, registration and the token endpoint are called by apps
 * (some from a browser, like the MCP Inspector), so they allow any origin: they carry no cookies and
 * PKCE protects the code.
 */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export const oauthJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } });

export const oauthError = (error: string, description: string, status = 400) => oauthJson({ error, error_description: description }, status);

export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** A form-encoded body (RFC 6749), or a JSON one (some clients send that), as plain strings. */
export async function formParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (text.length > 16_384) return {};
  if (type.includes("application/json")) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}
