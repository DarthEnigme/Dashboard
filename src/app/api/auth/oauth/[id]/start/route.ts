import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { publicOrigin } from "@/lib/auth";
import { startLogin, STATE_COOKIE } from "@/lib/auth/oauth";
import { isHttps } from "@/lib/auth/session";
import { errorReason } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = publicOrigin(req);
  const provider = loadConfig().settings.auth.providers.find((p) => p.id === id);
  if (!provider) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Unknown login provider")}`);
  try {
    const { url, cookie } = await startLogin(provider, origin);
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: isHttps(req), path: "/api/auth/oauth", maxAge: 600 });
    return res;
  } catch (e) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(`${provider.id}: ${errorReason(e)}`)}`);
  }
}
