import { NextResponse } from "next/server";
import { sameOrigin, viewer } from "@/lib/auth";
import { listSessions, revokeSession, revokeUserSessions } from "@/lib/auth/sessions";
import { audit } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Where you are signed in. */
export async function GET() {
  const v = await viewer();
  if (!v.user) return err("Sign in first", 401);
  return NextResponse.json(
    listSessions(v.user.id).map((s) => ({
      id: s.id,
      current: s.id === v.sessionId,
      createdAt: s.created_at,
      lastSeen: s.last_seen,
      expiresAt: s.expires_at,
      ip: s.ip,
      userAgent: s.user_agent,
      method: s.method,
    })),
  );
}

/** ?id= signs out one session; ?others=1 every session but this one. */
export async function DELETE(req: Request) {
  const v = await viewer();
  if (!v.user) return err("Sign in first", 401);
  if (!sameOrigin(req)) return err("Cross-site request refused", 403);
  const q = new URL(req.url).searchParams;
  if (q.get("others")) {
    const n = revokeUserSessions(v.user.id, v.sessionId);
    audit(v.user.username, "sessions-revoked", { count: n });
  } else if (!revokeSession(q.get("id") ?? "", v.user.id)) return err("No such session", 404);
  return NextResponse.json({ ok: true });
}
