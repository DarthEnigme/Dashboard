import { get } from "./http";

/** Symbol search: shares, funds, indexes by name or symbol. */
export interface SymbolHit {
  symbol: string;
  name: string;
  exchange: string | null;
  /** EQUITY, ETF, INDEX, CURRENCY, CRYPTOCURRENCY, MUTUALFUND… */
  type: string;
  sector: string | null;
  industry: string | null;
}

interface YahooSearch {
  quotes?: { symbol?: string; shortname?: string; longname?: string; exchDisp?: string; quoteType?: string; sector?: string; industry?: string }[];
}

export function parseSearch(r: YahooSearch): SymbolHit[] {
  return (r.quotes ?? [])
    .filter((q): q is typeof q & { symbol: string } => typeof q.symbol === "string" && q.symbol.length > 0)
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname ?? q.shortname ?? q.symbol,
      exchange: q.exchDisp ?? null,
      type: q.quoteType ?? "EQUITY",
      sector: q.sector ?? null,
      industry: q.industry ?? null,
    }));
}

export const searchSymbols = async (q: string) => parseSearch(await get<YahooSearch>(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`));
