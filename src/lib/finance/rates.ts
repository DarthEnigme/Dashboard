import { httpJson } from "../http";
import { currenciesInUse, getMeta, setMeta } from "./store";

/** Units of each currency for one unit of `base` (ECB reference rates). */
export interface Rates {
  base: string;
  date: string;
  rates: Record<string, number>;
}

const TTL = 6 * 60 * 60_000;
const g = globalThis as typeof globalThis & { __pageRates?: Map<string, { at: number; value: Rates }> };
const cache = (g.__pageRates ??= new Map());

/**
 * Latest rates for a base currency via Frankfurter (no key), cached for 6 hours. The last good answer is
 * kept in the database, so conversion keeps working offline. Undefined when the currency has no ECB rate.
 */
export async function ratesFor(base: string): Promise<Rates | undefined> {
  const b = base.toUpperCase();
  const hit = cache.get(b);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  try {
    const r = await httpJson<{ base: string; date: string; rates: Record<string, number> }>(
      `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(b)}`,
      { timeoutMs: 5000 },
    );
    const value: Rates = { base: b, date: r.date, rates: { ...r.rates, [b]: 1 } };
    cache.set(b, { at: Date.now(), value });
    setMeta(`rates:${b}`, JSON.stringify(value));
    return value;
  } catch {
    const saved = getMeta(`rates:${b}`);
    if (!saved) return undefined;
    const value = JSON.parse(saved) as Rates;
    // Retry the network in 10 minutes rather than on every request.
    cache.set(b, { at: Date.now() - TTL + 10 * 60_000, value });
    return value;
  }
}

/** Rates to show everything in `currency`, fetched only when transactions (or `also`) use another currency. */
export async function ratesForSummary(currency: string, also: string[] = []): Promise<Rates | undefined> {
  const others = [...currenciesInUse(), ...also.map((c) => c.toUpperCase())].filter((c) => c !== currency.toUpperCase());
  return others.length ? ratesFor(currency) : undefined;
}
