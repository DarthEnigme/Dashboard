import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { loadConfig } from "@/lib/config/load";
import { publicOrigin } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/identity";
import { finishLogin, STATE_COOKIE } from "@/lib/auth/oauth";
import { cookieOptions, isHttps, SESSION_COOKIE, sessionToken } from "@/lib/auth/session";
import { audit } from "@/lib/auth/users";
import { errorReason } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = publicOrigin(req);
  const { auth } = loadConfig().settings;
  const provider = auth.providers.find((p) => p.id === id);
  const back = (error: string) => {
    const res = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}`);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/auth/oauth" });
    return res;
  };
  if (!provider) return back("Unknown login provider");

  try {
    const state = (await cookies()).get(STATE_COOKIE)?.value;
    const identity = await finishLogin(provider, origin, new URL(req.url), state);
    const result = resolveIdentity(identity, {
      signup: provider.signup,
      defaultRole: auth.defaultRole,
      adminGroup: provider.adminGroup,
    });
    if (!result.ok) {
      audit(identity.email ?? identity.username ?? identity.subject, "login-refused", { provider: id, reason: result.error });
      return back(result.error);
    }
    audit(result.user.username, result.created ? "signup" : "login", { provider: id });
    const res = NextResponse.redirect(`${origin}/`);
    res.cookies.set(SESSION_COOKIE, await sessionToken(result.user.id), cookieOptions(isHttps(req)));
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/auth/oauth" });
    return res;
  } catch (e) {
    return back(errorReason(e));
  }
}
