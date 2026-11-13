import type { Position, Series, Snapshot, Summary, Transaction } from "./types";

/**
 * Portfolio arithmetic: positions, gains, dividends and the value over time, from trades and
 * market data. Pure functions: no database, no network, so every figure can be checked by hand.
 *
 * Shares are counted in today's shares throughout: Yahoo's past closes and dividends are already
 * adjusted for splits, so trades made before a split are restated the same way first.
 */

export interface Trade {
  symbol: string;
  kind: "buy" | "sell";
  /** YYYY-MM-DD */
  day: string;
  quantity: number;
  /** Per share, in the symbol's quote currency (as are the fees). */
  price: number;
  fees: number;
}

/** Transactions as entered, as the arithmetic reads them. */
export const toTrades = (transactions: Transaction[]): Trade[] => transactions.map((t) => ({ symbol: t.symbol, kind: t.kind, day: t.date, quantity: t.quantity, price: t.price, fees: t.fees }));

/** What is known of a symbol's market: the part of a Yahoo history the arithmetic needs. */
export interface Market {
  name: string;
  currency: string;
  sector?: string | null;
  price: number;
  change: number | null;
  days: string[];
  closes: number[];
  dividends: { day: string; amount: number }[];
  splits: { day: string; ratio: number }[];
}

export type { Series } from "./types";

/** Units of the portfolio's currency for one unit of `currency` on `day`. */
export type Fx = (currency: string, day: string) => number;

/** The value on `day`: that day's, else the last one before it, else the first one known. */
export function valueAt(s: Series, day: string): number | undefined {
  let lo = 0;
  let hi = s.days.length - 1;
  if (hi < 0) return undefined;
  if (day < s.days[0]) return s.closes[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.days[mid] <= day) lo = mid;
    else hi = mid - 1;
  }
  return s.closes[lo];
}

/**
 * Rates from histories of each currency priced in the portfolio's (USD → the USDEUR=X series).
 * Pence ("GBp", "ZAc"…: a lowercase last letter) are a hundredth of their currency. A currency
 * with no history converts at 1, which `missing` reports.
 */
export function makeFx(base: string, rates: Map<string, Series>, missing: (currency: string) => void = () => {}): Fx {
  return (currency, day) => {
    const minor = /[a-z]$/.test(currency);
    const major = currency.toUpperCase();
    if (major === base.toUpperCase()) return minor ? 0.01 : 1;
    const rate = rates.has(major) ? valueAt(rates.get(major)!, day) : undefined;
    if (rate === undefined) missing(major);
    return (rate ?? 1) * (minor ? 0.01 : 1);
  };
}

/** Trades restated in today's shares: one made before a 4-for-1 split becomes four times the shares at a quarter of the price. */
export function adjustForSplits(trades: Trade[], splits: Market["splits"]): Trade[] {
  if (!splits.length) return trades;
  return trades.map((t) => {
    const factor = splits.filter((s) => s.day > t.day).reduce((f, s) => f * s.ratio, 1);
    return factor === 1 ? t : { ...t, quantity: t.quantity * factor, price: t.price / factor };
  });
}

const byDay = (a: Trade, b: Trade) => a.day.localeCompare(b.day) || (a.kind === b.kind ? 0 : a.kind === "buy" ? -1 : 1);
const EPSILON = 1e-9;
const pct = (part: number, whole: number) => (whole > EPSILON ? (part / whole) * 100 : null);

/** One symbol's position after its trades (average-cost method: a sale leaves the average cost of what remains unchanged). */
function positionOf(symbol: string, trades: Trade[], market: Market | undefined, fx: Fx, today: string): Omit<Position, "weight" | "dividends"> {
  const currency = market?.currency ?? "";
  let quantity = 0;
  let cost = 0; // quote currency
  let costBase = 0; // portfolio currency, at each buy's rate
  let realized = 0;
  let lastPrice = 0;
  for (const t of trades) {
    const rate = fx(currency, t.day);
    lastPrice = t.price;
    if (t.kind === "buy") {
      quantity += t.quantity;
      cost += t.quantity * t.price + t.fees;
      costBase += (t.quantity * t.price + t.fees) * rate;
      continue;
    }
    // Selling more than is held sells what is held.
    const sold = Math.min(t.quantity, quantity);
    if (sold <= EPSILON) continue;
    const share = sold / quantity;
    realized += (sold * t.price - t.fees) * rate - costBase * share;
    cost -= cost * share;
    costBase -= costBase * share;
    quantity -= sold;
    if (quantity <= EPSILON) quantity = cost = costBase = 0;
  }
  const price = market?.price ?? lastPrice;
  const value = quantity * price * fx(currency, today);
  return {
    symbol,
    name: market?.name ?? symbol,
    currency,
    sector: market?.sector ?? null,
    quantity,
    avgCost: quantity > EPSILON ? cost / quantity : 0,
    price,
    change: market?.change ?? null,
    value,
    cost: costBase,
    gain: value - costBase,
    gainPct: pct(value - costBase, costBase),
    realized,
    unpriced: !market,
  };
}

/** Shares held at the open of `day` (trades made that day don't count yet). */
function heldBefore(trades: Trade[], day: string): number {
  let quantity = 0;
  for (const t of trades) {
    if (t.day >= day) break;
    quantity = t.kind === "buy" ? quantity + t.quantity : Math.max(quantity - t.quantity, 0);
  }
  return quantity;
}

/** Trades grouped by symbol, restated in today's shares and in the order they happened. */
function bySymbolOf(trades: Trade[], markets: Map<string, Market>): Map<string, Trade[]> {
  const bySymbol = new Map<string, Trade[]>();
  for (const t of trades) bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  for (const [symbol, list] of bySymbol) bySymbol.set(symbol, adjustForSplits(list, markets.get(symbol)?.splits ?? []).sort(byDay));
  return bySymbol;
}

/**
 * Everything the portfolio page shows: the snapshot, and the value over time with `benchmark`
 * compared over the same days.
 */
export function summarize(trades: Trade[], markets: Map<string, Market>, fx: Fx, currency: string, today: string, benchmark?: Series): Summary {
  return { ...snapshot(trades, markets, fx, currency, today), series: valueOverTime(bySymbolOf(trades, markets), markets, fx, today, benchmark) };
}

/**
 * Where the portfolio stands today: positions, gains and dividends. `trades` are as entered;
 * `markets` holds what Yahoo knows of each symbol (a symbol missing from it is valued at the last
 * price paid).
 */
export function snapshot(trades: Trade[], markets: Map<string, Market>, fx: Fx, currency: string, today: string): Snapshot {
  const bySymbol = bySymbolOf(trades, markets);

  // Each dividend goes to the shares held before its ex-dividend day.
  const paid = [...bySymbol].flatMap(([symbol, list]) => {
    const m = markets.get(symbol);
    return (m?.dividends ?? []).map((d) => ({ day: d.day, symbol, amount: heldBefore(list, d.day) * d.amount * fx(m!.currency, d.day) })).filter((d) => d.amount > EPSILON);
  });
  const sumBy = (key: (d: (typeof paid)[number]) => string) => paid.reduce((sums, d) => sums.set(key(d), (sums.get(key(d)) ?? 0) + d.amount), new Map<string, number>());
  const perSymbol = sumBy((d) => d.symbol);

  const all = [...bySymbol].map(([symbol, list]) => ({ ...positionOf(symbol, list, markets.get(symbol), fx, today), dividends: perSymbol.get(symbol) ?? 0 }));
  const held = all.filter((p) => p.quantity > EPSILON).sort((a, b) => b.value - a.value);
  const value = held.reduce((s, p) => s + p.value, 0);
  const cost = held.reduce((s, p) => s + p.cost, 0);
  const weigh = (p: Omit<Position, "weight">): Position => ({ ...p, weight: value > EPSILON ? p.value / value : 0 });
  // Yesterday's value of what is held today; a position with no change known counts as flat.
  const before = held.reduce((s, p) => s + p.value / (1 + (p.change ?? 0) / 100), 0);

  return {
    currency,
    value,
    cost,
    gain: value - cost,
    gainPct: pct(value - cost, cost),
    realized: all.reduce((s, p) => s + p.realized, 0),
    dividends: all.reduce((s, p) => s + p.dividends, 0),
    dayChange: value - before,
    dayChangePct: pct(value - before, before),
    positions: held.map(weigh),
    closed: all.filter((p) => p.quantity <= EPSILON).sort((a, b) => b.realized - a.realized).map(weigh),
    dividendYears: [...sumBy((d) => d.day.slice(0, 4))].sort(([a], [b]) => a.localeCompare(b)).map(([year, amount]) => ({ year, amount })),
    dividendList: paid.sort((a, b) => b.day.localeCompare(a.day)),
  };
}

/**
 * The portfolio day by day, from the first trade: its value, the money put in (less what was
 * taken out), and its time-weighted return — each day's gain over the value it started with plus
 * what was added that day, chained — so adding money doesn't count as performance.
 */
function valueOverTime(bySymbol: Map<string, Trade[]>, markets: Map<string, Market>, fx: Fx, today: string, benchmark?: Series): Summary["series"] {
  const first = [...bySymbol.values()].flat().reduce<string | undefined>((min, t) => (min === undefined || t.day < min ? t.day : min), undefined);
  const empty = { days: [], value: [], invested: [], performance: [], benchmark: null };
  if (!first) return empty;
  const days = [...new Set([...[...bySymbol.keys()].flatMap((s) => markets.get(s)?.days ?? []), today])].filter((d) => d >= first && d <= today).sort();
  if (!days.length) return empty;

  const cursors = [...bySymbol].map(([symbol, trades]) => ({ trades, market: markets.get(symbol), next: 0, quantity: 0, lastPrice: 0 }));
  const value: number[] = [];
  const invested: number[] = [];
  const performance: number[] = [];
  let put = 0;
  let growth = 1;
  let previous = 0;
  for (const day of days) {
    let flow = 0;
    let total = 0;
    for (const c of cursors) {
      const currency = c.market?.currency ?? "";
      // Trades up to this day (one made on a day markets were shut lands on the next open day).
      for (; c.next < c.trades.length && c.trades[c.next].day <= day; c.next++) {
        const t = c.trades[c.next];
        const rate = fx(currency, t.day);
        c.lastPrice = t.price;
        if (t.kind === "buy") {
          c.quantity += t.quantity;
          flow += (t.quantity * t.price + t.fees) * rate;
        } else {
          const sold = Math.min(t.quantity, c.quantity);
          c.quantity -= sold;
          flow -= (sold * t.price - t.fees) * rate;
        }
      }
      if (c.quantity > EPSILON) total += c.quantity * ((c.market && valueAt(c.market, day)) ?? c.lastPrice) * fx(currency, day);
    }
    const start = previous + Math.max(flow, 0);
    if (start > EPSILON) growth *= 1 + (total - previous - flow) / start;
    put += flow;
    previous = total;
    value.push(total);
    invested.push(put);
    performance.push((growth - 1) * 100);
  }

  const origin = benchmark && valueAt(benchmark, days[0]);
  return { days, value, invested, performance, benchmark: benchmark && origin ? days.map((d) => (valueAt(benchmark, d)! / origin - 1) * 100) : null };
}

/** Dividends per share by calendar year, oldest first. */
export function dividendsByYear(dividends: Market["dividends"]): { year: string; amount: number }[] {
  const years = new Map<string, number>();
  for (const d of dividends) years.set(d.day.slice(0, 4), (years.get(d.day.slice(0, 4)) ?? 0) + d.amount);
  return [...years].sort(([a], [b]) => a.localeCompare(b)).map(([year, amount]) => ({ year, amount }));
}

/** The indexes of at most `max` of `n` points, evenly spread and always ending on the last one. */
export function thinIndexes(n: number, max: number): number[] {
  const step = n <= max ? 1 : Math.ceil(n / max);
  return Array.from({ length: n }, (_, i) => i).filter((i) => (n - 1 - i) % step === 0);
}

/** At most `max` points of a series, evenly spread and always ending on the last one. */
export function thin(s: Series, max: number): Series {
  if (s.days.length <= max) return s;
  const keep = thinIndexes(s.days.length, max);
  return { days: keep.map((i) => s.days[i]), closes: keep.map((i) => s.closes[i]) };
}
