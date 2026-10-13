const WINDOW = 15 * 60_000;
const MAX_FAILURES = 10;
/** For a username whatever the address: X-Forwarded-For can be made up by a client that reaches NanoDash directly. */
export const MAX_USER_FAILURES = 30;
const MAX_KEYS = 10_000;

const failures = new Map<string, number[]>();

const recent = (key: string) => (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW);

/** True while this key has too many recent failed logins. */
export function isLimited(key: string, max = MAX_FAILURES): boolean {
  return recent(key).length >= max;
}

export function recordFailure(key: string) {
  // Re-inserted, so the map stays ordered by last failure (oldest first).
  const list = [...recent(key), Date.now()];
  failures.delete(key);
  failures.set(key, list);
  if (failures.size <= MAX_KEYS) return;
  for (const k of failures.keys()) if (!recent(k).length) failures.delete(k);
  for (const k of failures.keys()) {
    if (failures.size <= MAX_KEYS) break;
    failures.delete(k);
  }
}

export const clearFailures = (key: string) => failures.delete(key);

/** Best-effort client address: the first X-Forwarded-For hop, as set by your proxy. */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "direct";
