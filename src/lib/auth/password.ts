import crypto from "node:crypto";

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

const scrypt = (password: string, salt: Buffer, n = N, rr = r, pp = p) =>
  new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, KEYLEN, { N: n, r: rr, p: pp, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

/** "scrypt$N$r$p$salt$hash" (base64url), so parameters can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, rr, pp, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password, Buffer.from(salt, "base64url"), Number(n), Number(rr), Number(pp));
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export const MIN_PASSWORD = 8;

let dummy: Promise<string> | undefined;
/** Spend the same time as a real check, so response times don’t reveal which usernames exist. */
export async function burnPasswordCheck(password: string) {
  dummy ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(password, await dummy);
}
