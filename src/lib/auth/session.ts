import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SignJWT, jwtVerify } from "jose";
import { DATA_DIR } from "../db";

export const SESSION_COOKIE = "page_session";
export const SESSION_DAYS = 30;

let key: Uint8Array | undefined;

/** HOMEPAGE_SECRET, or a random key generated once into the data directory. */
export function secretKey(): Uint8Array {
  if (key) return key;
  let secret = process.env.HOMEPAGE_SECRET;
  if (!secret) {
    const file = path.join(DATA_DIR, "secret.key");
    try {
      secret = fs.readFileSync(file, "utf8").trim();
    } catch {
      secret = crypto.randomBytes(32).toString("hex");
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(file, secret, { mode: 0o600 });
    }
  }
  key = new TextEncoder().encode(secret);
  return key;
}

export const signToken = (claims: Record<string, unknown>, subject: string, expires: string) =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(subject).setIssuedAt().setExpirationTime(expires).sign(secretKey());

export async function verifyToken(token: string | undefined): Promise<{ sub: string; [k: string]: unknown } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.sub ? (payload as { sub: string }) : null;
  } catch {
    return null;
  }
}

export const sessionToken = (userId: number) => signToken({ kind: "session" }, String(userId), `${SESSION_DAYS}d`);

export const cookieOptions = (secure: boolean) => ({
  httpOnly: true,
  // Lax (not Strict) so the cookie survives the redirect back from an OAuth provider.
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 3600,
});

/** Is the original request HTTPS (directly or through a proxy)? */
export const isHttps = (req: Request) =>
  new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
