import type { Fx, Market } from "./portfolio";

/**
 * Dividends expected over the next twelve months: each dividend of the last twelve months comes
 * again a year later, per share as before, on the shares held now. A plain estimate (companies
 * change their dividend, and Yahoo dates them by the ex-dividend day), but it shows when money
 * comes in and roughly how much. Pure, like the rest of the arithmetic.
 */

export interface ExpectedDividend {
  /** The ex-dividend day a year after the last one. */
  day: string;
  symbol: string;
  /** In the portfolio's currency, before tax. */
  amount: number;
}

export interface DividendForecast {
  total: number;
  /** The next twelve calendar months, this one first. */
  months: { month: string; amount: number }[];
  /** Soonest first. */
  payments: ExpectedDividend[];
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const YEAR_DAYS = 365;
const DAY = 86_400_000;

/** The same day a year later (Feb 29 becomes Feb 28). */
const yearLater = (day: string) => {
  const d = new Date(Date.parse(day));
  const next = Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate());
  return new Date(next).getUTCMonth() === d.getUTCMonth() ? iso(next) : iso(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth() + 1, 0));
};

/** The twelve months from `today`'s, as YYYY-MM. */
function nextMonths(today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const month = m - 1 + i;
    return `${y + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}`;
  });
}

export function forecastDividends(held: { symbol: string; quantity: number }[], markets: Map<string, Pick<Market, "currency" | "dividends">>, fx: Fx, today: string): DividendForecast {
  const since = iso(Date.parse(today) - YEAR_DAYS * DAY);
  const payments = held
    .flatMap(({ symbol, quantity }) => {
      const m = markets.get(symbol);
      if (!m || quantity <= 0) return [];
      const rate = fx(m.currency, today);
      return m.dividends.filter((d) => d.day > since && d.day <= today).map((d) => ({ day: yearLater(d.day), symbol, amount: d.amount * quantity * rate }));
    })
    .filter((p) => p.amount > 0 && p.day > today)
    .sort((a, b) => a.day.localeCompare(b.day) || a.symbol.localeCompare(b.symbol));
  const byMonth = new Map(nextMonths(today).map((month) => [month, 0]));
  for (const p of payments) {
    const month = p.day.slice(0, 7);
    if (byMonth.has(month)) byMonth.set(month, byMonth.get(month)! + p.amount);
  }
  return { total: payments.reduce((s, p) => s + p.amount, 0), months: [...byMonth].map(([month, amount]) => ({ month, amount })), payments };
}
