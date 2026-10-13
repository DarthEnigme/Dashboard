const store = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

// Keys carry request parameters (search terms, chart ranges): without this, answers nobody asks for again would stay for good.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > v.ttl) store.delete(k);
}, 60_000);
sweep.unref?.();

/**
 * Memoize an async call for `ttlMs`. Concurrent callers share one in-flight promise,
 * and failures are evicted so the next call retries.
 */
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn();
  store.set(key, { at: Date.now(), ttl: ttlMs, value });
  value.catch(() => {
    if (store.get(key)?.value === value) store.delete(key);
  });
  return value;
}

/** Drop cached values whose key starts with `prefix` (after an action changed what they show). */
export function forget(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

/** Network errors carry the useful part ("ECONNREFUSED") in `cause.code`. */
export function errorReason(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } };
  return err.cause?.code ?? err.message ?? String(e);
}
