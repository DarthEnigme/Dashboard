import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/auth";
import { clearFailures, isLimited, recordFailure } from "@/lib/auth/ratelimit";
import { verifyToken } from "@/lib/auth/session";
import { startSession } from "@/lib/auth/sessions";
import { matchTotpStep, openSecret, spendRecoveryCode } from "@/lib/auth/totp";
import * as users from "@/lib/auth/users";
import { count } from "@/lib/stats";

export const dynamic = "force-dynamic";

const fail = (error: string, status = 401) => NextResponse.json({ error }, { status });

/** Second sign-in step: { ticket (from POST /api/auth), code (6 digits, or a recovery code) }. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail("Cross-site request refused", 403);
  const { ticket, code = "" } = ((await req.json().catch(() => ({}))) ?? {}) as { ticket?: string; code?: string };
  const claims = await verifyToken(ticket);
  if (claims?.kind !== "2fa") return fail("The sign-in took too long. Start again.");
  const user = users.getUser(Number(claims.sub));
  const tf = user && users.getTwoFactor(user.id);
  if (!user || user.disabled || !tf) return fail("Start the sign-in again.");

  const limitKey = `2fa|${user.id}`;
  if (isLimited(limitKey)) return fail("Too many wrong codes. Try again in 15 minutes.", 429);
  const secret = openSecret(tf.secret);
  const step = secret ? matchTotpStep(secret, code) : undefined;
  // A code works once: someone who saw it typed can't sign in with it too.
  let ok = step !== undefined && step > (users.totpStep(user.id) ?? -1);
  let usedRecovery = false;
  if (!ok) {
    const left = spendRecoveryCode(tf.recovery, code);
    if (left) {
      users.setTwoFactor(user.id, { secret: tf.secret, recovery: left });
      ok = usedRecovery = true;
    }
  }
  if (!ok) {
    recordFailure(limitKey);
    count("page_login_failures_total");
    users.audit(user.username, "login-failed", { method: "2fa" });
    return fail("Wrong code");
  }
  clearFailures(limitKey);
  count("page_logins_total");
  if (!usedRecovery) users.setTotpStep(user.id, step!);
  const method = typeof claims.method === "string" ? claims.method : "password";
  users.audit(user.username, "login", { method, twoFactor: usedRecovery ? "recovery-code" : "totp" });
  const res = NextResponse.json({ ok: true, recoveryCodesLeft: usedRecovery ? users.getTwoFactor(user.id)?.recovery.length : undefined });
  await startSession(res, req, user.id, method, claims.remember !== false);
  return res;
}
