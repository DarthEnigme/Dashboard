import { z } from "zod";
import { httpJson } from "@/lib/http";
import { fetchQuote } from "@/lib/stocks/yahoo";
import type { InfoProvider, MarketsData, Quote } from "./types";

const schema = z.object({
  /** Yahoo Finance symbols: AAPL, ^GSPC, MC.PA, EURUSD=X */
  symbols: z.array(z.string()).default([]),
  /** CoinGecko coin ids: bitcoin, ethereum */
  crypto: z.array(z.string()).default([]),
  /** Quote currency for crypto */
  currency: z.string().default("usd"),
});

export function parseCoinGecko(r: Record<string, Record<string, number>>, ids: string[], currency: string): Quote[] {
  const cur = currency.toLowerCase();
  return ids
    .filter((id) => r[id]?.[cur] !== undefined)
    .map((id) => ({
      symbol: id,
      price: r[id][cur],
      change: r[id][`${cur}_24h_change`] ?? null,
      currency: cur.toUpperCase(),
    }));
}

export const markets: InfoProvider<typeof schema, MarketsData> = {
  type: "markets",
  schema,
  ttlMs: 5 * 60_000,
  async fetch(cfg) {
    const errors: string[] = [];
    const stocks = await Promise.all(
      cfg.symbols.map(async (sym) => {
        try {
          return await fetchQuote(sym);
        } catch (e) {
          errors.push(`${sym}: ${(e as Error).message}`);
          return null;
        }
      }),
    );
    let coins: Quote[] = [];
    if (cfg.crypto.length) {
      try {
        const q = new URLSearchParams({ ids: cfg.crypto.join(","), vs_currencies: cfg.currency, include_24hr_change: "true" });
        coins = parseCoinGecko(await httpJson(`https://api.coingecko.com/api/v3/simple/price?${q}`), cfg.crypto, cfg.currency);
      } catch (e) {
        errors.push(`crypto: ${(e as Error).message}`);
      }
    }
    return { quotes: [...stocks.filter((s): s is Quote => !!s), ...coins], errors };
  },
};
