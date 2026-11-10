import { cached } from "../cache";
import { db } from "../db";

/**
 * Yahoo answers, kept: in memory for `ttlMs` (concurrent callers share one request), and in the
 * database so a restart doesn't ask again and so the last good answer still shows when Yahoo
 * doesn't respond.
 */
export function remembered<T>(key: string, ttlMs: number, fetch: () => Promise<T>): Promise<T> {
  return cached(`stocks:${key}`, ttlMs, async () => {
    const row = db().prepare("SELECT at, value FROM stock_cache WHERE key = ?").get(key) as { at: number; value: string } | undefined;
    if (row && Date.now() - row.at < ttlMs) return JSON.parse(row.value) as T;
    try {
      const value = await fetch();
      db().prepare("INSERT OR REPLACE INTO stock_cache (key, at, value) VALUES (?, ?, ?)").run(key, Date.now(), JSON.stringify(value));
      return value;
    } catch (e) {
      if (row) return JSON.parse(row.value) as T;
      throw e;
    }
  });
}

/** Hourly: forget answers nobody has asked for in a month. */
export async function pruneStockCache(now = Date.now()) {
  db().prepare("DELETE FROM stock_cache WHERE at < ?").run(now - 30 * 86_400_000);
}
