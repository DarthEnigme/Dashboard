import { number } from "@/i18n/format";
import { money } from "@/lib/finance/format";

/** An amount in a portfolio's currency. */
export const cash = (amount: number, currency: string, signed = false) => money(Math.round(amount * 100), currency, signed);

/** A price in the currency a symbol is quoted in, to the cent. Pence and the like ("GBp") and unknown currencies are written out, not as a symbol. */
export const quoted = (price: number, currency: string) =>
  /^[A-Z]{3}$/.test(currency) ? number(price, { style: "currency", currency, maximumFractionDigits: 2 }) : `${number(price, { maximumFractionDigits: 2 })} ${currency}`.trim();

export const percent = (n: number | null, signed = true) => (n === null ? "–" : `${signed && n > 0 ? "+" : ""}${number(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);

/** Shares: whole when whole, else up to four decimals. */
export const shares = (n: number) => number(n, { maximumFractionDigits: 4 });

/** Big company figures: 416 B, 12.4 M. */
export const big = (n: number) => {
  const a = Math.abs(n);
  const [scaled, unit] = a >= 1e12 ? [n / 1e12, " T"] : a >= 1e9 ? [n / 1e9, " B"] : a >= 1e6 ? [n / 1e6, " M"] : a >= 1e3 ? [n / 1e3, " K"] : [n, ""];
  return `${number(scaled, { maximumFractionDigits: Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2 })}${unit}`;
};

/** Green when up, red when down, plain when flat or unknown. */
export const tone = (n: number | null) => (n === null || n === 0 ? "" : n > 0 ? "text-[var(--ok)]" : "text-[var(--err)]");

export const stockHref = (symbol: string) => `/stocks/${encodeURIComponent(symbol)}`;
