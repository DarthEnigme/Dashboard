import { z } from "zod";
import { httpJson } from "@/lib/http";
import type { InfoProvider, MarketsData, Quote } from "./types";

const schema = z.object({
  /** Yahoo Finance symbols: AAPL, ^GSPC, MC.PA, EURUSD=X */
  symbols: z.array(z.string()).default([]),
  /** CoinGecko coin ids: bitcoin, ethereum */
  crypto: z.array(z.string()).default([]),
  /** Quote currency for crypto */
  currency: z.string().default("usd"),
});

// Yahoo rejects requests without a browser-like user agent.
// (It also rate-limits some UA strings, e.g. Linux Chrome, so this one is deliberate.)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export interface YahooChart {
  chart: {
    result: { meta: { symbol: string; shortName?: string; currency: string; regularMarketPrice: number; chartPreviousClose?: number; previousClose?: number } }[] | null;
    error: { description: string } | null;
  };
}

export function parseYahoo(r: YahooChart): Quote {
  const meta = r.chart.result?.[0]?.meta;
  if (!meta) throw new Error(r.chart.error?.description ?? "No data");
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  return {
    symbol: meta.symbol,
    name: meta.shortName,
    price: meta.regularMarketPrice,
    change: prev ? ((meta.regularMarketPrice - prev) / prev) * 100 : null,
    currency: meta.currency,
  };
}

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
          const r = await httpJson<YahooChart>(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`,
            { headers: { "User-Agent": UA } },
          );
          return parseYahoo(r);
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
