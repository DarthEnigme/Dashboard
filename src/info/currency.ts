import { z } from "zod";
import { httpJson } from "@/lib/http";
import type { CurrencyData, InfoProvider } from "./types";

const schema = z.object({
  base: z.string().length(3).default("EUR"),
  symbols: z.array(z.string().length(3)).min(1),
});

export function parseFrankfurter(r: { base: string; date: string; rates: Record<string, number> }): CurrencyData {
  return {
    base: r.base,
    date: r.date,
    rates: Object.entries(r.rates).map(([symbol, rate]) => ({ symbol, rate })),
  };
}

/** ECB reference rates via Frankfurter (no key). Updated once per working day. */
export const currency: InfoProvider<typeof schema, CurrencyData> = {
  type: "currency",
  schema,
  ttlMs: 60 * 60_000,
  async fetch(cfg) {
    const q = new URLSearchParams({ base: cfg.base.toUpperCase(), symbols: cfg.symbols.map((s) => s.toUpperCase()).join(",") });
    return parseFrankfurter(await httpJson(`https://api.frankfurter.dev/v1/latest?${q}`));
  },
};
