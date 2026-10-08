import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { loadConfig } from "@/lib/config/load";
import { sameOrigin, viewer } from "@/lib/auth";
import { verifyPassword } from "@/lib/auth/password";
import { clearFailures, isLimited, recordFailure } from "@/lib/auth/ratelimit";
import { signToken, verifyToken } from "@/lib/auth/session";
import { revokeUserSessions } from "@/lib/auth/sessions";
import { newRecoveryCodes, newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from "@/lib/auth/totp";
import * as users from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Two-factor sign-in for your own account:
 * { action: "start" } → a new secret as a QR code (held in a signed setup token, nothing stored yet);
 * { action: "enable", setup, code } → stores it once a code from the app checks out, returns recovery codes;
 * { action: "recovery", code } → new recovery codes (the old ones stop working);
 * { action: "disable", password or code } → turns it off.
 */
export async function POST(req: Request) {
  const v = await viewer();
  const me = v.user;
  if (!me) return err("Sign in first", 401);
  if (!sameOrigin(req)) return err("Cross-site request refused", 403);
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { action?: string; setup?: string; code?: string; password?: string };
  const limitKey = `2fa-profile|${me.id}`;
  if (isLimited(limitKey)) return err("Too many wrong codes. Try again in 15 minutes.", 429);
  const wrong = (msg = "Wrong code") => {
    recordFailure(limitKey);
    return err(msg, 403);
  };

  if (b.action === "start") {
    if (me.twoFactor) return err("Two-factor sign-in is already on");
    const secret = newTotpSecret();
    const url = otpauthUrl(secret, me.username, loadConfig().settings.title || "Page");
    return NextResponse.json({
      setup: await signToken({ kind: "2fa-setup", secret: sealSecret(secret) }, String(me.id), "15m"),
      secret,
      url,
      qr: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    });
  }

  if (b.action === "enable") {
    const claims = await verifyToken(b.setup);
    const secret = claims?.kind === "2fa-setup" && claims.sub === String(me.id) && typeof claims.secret === "string" ? openSecret(claims.secret) : undefined;
    if (!secret) return err("The setup expired. Start again.");
    if (!verifyTotp(secret, b.code ?? "")) return wrong("That code doesn't match. Check the time on your phone and try the next code.");
    clearFailures(limitKey);
    const { codes, hashes } = newRecoveryCodes();
    users.setTwoFactor(me.id, { secret: sealSecret(secret), recovery: hashes });
    // Anything signed in with only a password before this point is signed out.
    revokeUserSessions(me.id, v.sessionId);
    users.audit(me.username, "2fa-enabled");
    return NextResponse.json({ ok: true, recoveryCodes: codes });
  }

  const tf = users.getTwoFactor(me.id);
  if (!tf) return err("Two-factor sign-in is off");
  const secret = openSecret(tf.secret);
  const codeOk = !!secret && verifyTotp(secret, b.code ?? "");

  if (b.action === "recovery") {
    if (!codeOk) return wrong();
    clearFailures(limitKey);
    const { codes, hashes } = newRecoveryCodes();
    users.setTwoFactor(me.id, { secret: tf.secret, recovery: hashes });
    users.audit(me.username, "2fa-recovery-codes");
    return NextResponse.json({ ok: true, recoveryCodes: codes });
  }

  if (b.action === "disable") {
    const passwordOk = !!b.password && (await verifyPassword(b.password, users.passwordHash(me.id)));
    if (!codeOk && !passwordOk) return wrong("Enter a current code from your app, or your password");
    clearFailures(limitKey);
    users.setTwoFactor(me.id, null);
    users.audit(me.username, "2fa-disabled");
    return NextResponse.json({ ok: true });
  }

  return err("Unknown action");
}

/** How many recovery codes are left. */
export async function GET() {
  const me = (await viewer()).user;
  if (!me) return err("Sign in first", 401);
  return NextResponse.json({ enabled: me.twoFactor, recoveryCodesLeft: users.getTwoFactor(me.id)?.recovery.length ?? 0 });
}
