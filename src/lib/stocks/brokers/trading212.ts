import { httpJson, trimSlash } from "../../http";
import type { ImportedTrade } from "../import/presets";
import type { Broker } from "./types";

/**
 * Trading 212's public API (v0): filled orders from the history, with each instrument's ISIN from
 * the instruments list. The key is either an API key alone, or "key:secret" for the newer keys
 * (sent as Basic auth). The history endpoint allows a few calls a minute, so pages are fetched
 * slowly (PAGE_T212_DELAY_MS shortens that in tests).
 */

const base = () => trimSlash(process.env.PAGE_T212_URL ?? "https://live.trading212.com");
const delay = () => Number(process.env.PAGE_T212_DELAY_MS ?? 10_000);
const MAX_PAGES = 100;

const auth = (secret: string) => (secret.includes(":") ? `Basic ${Buffer.from(secret).toString("base64")}` : secret);

interface Instrument {
  ticker: string;
  isin?: string;
  currencyCode?: string;
  name?: string;
}

/** One history item, in the older flat shape or the newer { order, fill } one. */
type Item = Record<string, unknown> & { order?: Record<string, unknown>; fill?: Record<string, unknown> };

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** A filled order as a trade; anything else (cancelled, unfilled) is null. */
export function tradeOf(item: Item, instruments: Map<string, Instrument>, line: number): ImportedTrade | null {
  const order = item.order ?? item;
  const fill = item.fill ?? item;
  const status = str(order.status).toUpperCase();
  if (status && status !== "FILLED") return null;
  const instrument = (order.instrument as Instrument | undefined) ?? instruments.get(str(order.ticker));
  const signed = num(fill.quantity ?? order.filledQuantity);
  const price = num(fill.price ?? order.fillPrice);
  const day = str(fill.filledAt ?? order.dateExecuted ?? order.dateModified ?? order.dateCreated).slice(0, 10);
  if (!Number.isFinite(signed) || !signed || !Number.isFinite(price) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const side = str(order.side).toUpperCase();
  const taxes = (((fill.walletImpact as Record<string, unknown> | undefined)?.taxes ?? order.taxes ?? []) as { quantity?: number }[]).reduce((s, t) => s + Math.abs(num(t.quantity) || 0), 0);
  return {
    symbol: null,
    isin: instrument?.isin ?? null,
    name: instrument?.name ?? str(order.ticker),
    kind: side === "SELL" || (!side && signed < 0) ? "sell" : "buy",
    date: day,
    quantity: Math.abs(signed),
    price,
    fees: taxes,
    currency: instrument?.currencyCode ?? null,
    externalId: `trading212:${str(fill.id ?? order.id)}`,
    line,
  };
}

export const trading212: Broker = {
  kind: "t212",
  label: "Trading 212",
  async trades(secret) {
    const headers = { Authorization: auth(secret) };
    const instruments = new Map((await httpJson<Instrument[]>(`${base()}/api/v0/equity/metadata/instruments`, { headers, timeoutMs: 20_000 })).map((i) => [i.ticker, i]));
    const out: ImportedTrade[] = [];
    let path: string | null = "/api/v0/equity/history/orders?limit=50";
    for (let page = 0; path && page < MAX_PAGES; page++) {
      if (page > 0) await new Promise((r) => setTimeout(r, delay()));
      const res: { items?: Item[]; nextPagePath?: string | null } = await httpJson(`${base()}${path}`, { headers, timeoutMs: 20_000 });
      for (const item of res.items ?? []) {
        const t = tradeOf(item, instruments, out.length + 1);
        if (t) out.push(t);
      }
      path = res.nextPagePath ?? null;
    }
    return out;
  },
};
