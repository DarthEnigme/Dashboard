const WINDOW = 15 * 60_000;
const MAX_FAILURES = 10;

const failures = new Map<string, number[]>();

const recent = (key: string) => (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW);

/** True while this key has too many recent failed logins. */
export function isLimited(key: string): boolean {
  return recent(key).length >= MAX_FAILURES;
}

export function recordFailure(key: string) {
  failures.set(key, [...recent(key), Date.now()]);
  if (failures.size > 10_000) failures.clear();
}

export const clearFailures = (key: string) => failures.delete(key);

/** Best-effort client address: the first X-Forwarded-For hop, as set by your proxy. */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "direct";
