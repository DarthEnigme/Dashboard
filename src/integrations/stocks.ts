import { z } from "zod";
import { history } from "@/lib/stocks/service";
import { SYMBOL } from "@/lib/stocks/types";
import { localDay } from "@/lib/day";
import type { Integration, WidgetField, WidgetSpark } from "./types";

const schema = z.object({
  /** Yahoo Finance symbols: shares, funds, indexes, currencies. */
  symbols: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL.test(s)))
    .refine((v) => v.length > 0, "Give at least one symbol"),
});

const price = (n: number, currency: string) => `${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 })} ${currency}`.trim();
const pct = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n.toFixed(2)} %`);

/** Prices of a few symbols (public market data, nobody's portfolio): today's change, and their last month as a trend line. */
export const stocks: Integration<typeof schema> = {
  type: "stocks",
  schema,
  async fetch(cfg) {
    const from = new Date(Date.parse(localDay()) - 31 * 86_400_000).toISOString().slice(0, 10);
    const quotes = await Promise.all(cfg.symbols.slice(0, 12).map((s) => history(s, from).then((h) => ({ s, h })).catch(() => ({ s, h: undefined }))));
    const fields: WidgetField[] = quotes.map(({ s, h }) =>
      h ? { label: s, value: `${price(h.price, h.currency)} · ${pct(h.change)}`, status: h.change === null || h.change >= 0 ? "ok" : "error", raw: h.price, href: `/stocks/${encodeURIComponent(s)}` } : { label: s, value: "no data", status: "warn" },
    );
    const sparks: WidgetSpark[] = quotes.flatMap(({ s, h }) => (h && h.closes.length > 1 ? [{ label: s, values: h.closes, current: price(h.price, h.currency) }] : []));
    return { fields: fields.slice(0, 4), list: fields, sparks };
  },
};
