import { publicOrigin, requirePermission, requireUser, sameOrigin } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { approve, checkAuthorize, deny } from "@/lib/oauth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const see = (url: string) => new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
const refuse = (message: string, status: number) => new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * The consent page's answer (a same-site form post from /oauth/authorize, with the session cookie):
 * `decision=allow` sends a one-time code to the app, anything else tells it the person declined.
 * The request's parameters are checked again here: the page's hidden fields are only a copy.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return refuse("Cross-site request refused", 403);
  const origin = publicOrigin(req);
  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  const checked = checkAuthorize(form, origin);
  if ("fatal" in checked) return refuse(checked.fatal, 400);
  if ("redirect" in checked) return see(checked.redirect);

  const user = await requireUser();
  if (!user) {
    const { decision: _, ...request } = form; // eslint-disable-line @typescript-eslint/no-unused-vars
    return see(`${origin}/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(request)}`)}`);
  }
  const allowed = form.decision === "allow" && (await requirePermission("tasks"));
  audit(user.username, allowed ? "oauth-approve" : "oauth-deny", { client: checked.ok.client.name });
  return see(allowed ? approve(checked.ok, user.id, origin) : deny(checked.ok, origin));
}
