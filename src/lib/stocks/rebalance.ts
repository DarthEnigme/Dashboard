/**
 * Rebalancing: how far each holding is from the share of the portfolio it should be, and what to
 * buy or sell to get there. Pure, so the page works it out again as you type the cash to add.
 *
 * Targets are percents of the whole portfolio (what is held, plus the cash added). A holding with
 * no target is left as it is; what no target covers shows as unallocated.
 */

export interface Holding {
  symbol: string;
  name: string;
  /** In the portfolio's currency (0 for a target not held yet). */
  value: number;
  /** One share in the portfolio's currency; null when unknown (no price). */
  price: number | null;
}

export interface Target {
  symbol: string;
  /** Percent of the portfolio, 0 to 100. */
  weight: number;
}

export interface RebalanceRow {
  symbol: string;
  name: string;
  value: number;
  /** Percent of the portfolio now. */
  weight: number;
  /** Percent it should be; null when it has no target. */
  target: number | null;
  /** What it should be worth. */
  targetValue: number | null;
  /** To buy (more than 0) or sell (less than 0), in the portfolio's currency. */
  trade: number;
  /** The same in shares; null without a price. */
  shares: number | null;
}

export interface Rebalance {
  /** Held plus cash added. */
  total: number;
  rows: RebalanceRow[];
  /** Percent of the portfolio no target covers (holdings without one, and leftover). */
  unallocated: number;
  /** Cash left after the trades; less than 0 when the trades need more than was added. */
  cashLeft: number;
}

const EPSILON = 1e-9;

/**
 * `buyOnly`: nothing is sold; the cash goes to what is under its target, each in proportion to how
 * far under it is (all of it when there is enough).
 */
export function rebalance(holdings: Holding[], targets: Target[], cash: number, buyOnly: boolean): Rebalance {
  const total = holdings.reduce((s, h) => s + h.value, 0) + Math.max(cash, 0);
  const goal = new Map(targets.map((t) => [t.symbol, t.weight]));
  const bySymbol = new Map(holdings.map((h) => [h.symbol, h]));
  // Targets not held yet are rows too: they are what to buy.
  const all = [...holdings, ...targets.filter((t) => !bySymbol.has(t.symbol)).map((t) => ({ symbol: t.symbol, name: t.symbol, value: 0, price: null }))];
  const gap = (h: Holding) => (goal.has(h.symbol) ? (goal.get(h.symbol)! / 100) * total - h.value : 0);

  let scale = 1;
  if (buyOnly) {
    const needed = all.reduce((s, h) => s + Math.max(gap(h), 0), 0);
    scale = needed > EPSILON ? Math.min(1, Math.max(cash, 0) / needed) : 0;
  }
  const rows = all.map((h): RebalanceRow => {
    const target = goal.get(h.symbol) ?? null;
    const g = gap(h);
    const trade = buyOnly ? Math.max(g, 0) * scale : g;
    return {
      symbol: h.symbol,
      name: h.name,
      value: h.value,
      weight: total > EPSILON ? (h.value / total) * 100 : 0,
      target,
      targetValue: target === null ? null : (target / 100) * total,
      trade: Math.abs(trade) < 0.005 ? 0 : trade,
      shares: h.price && h.price > EPSILON ? trade / h.price : null,
    };
  });
  const targeted = targets.reduce((s, t) => s + t.weight, 0);
  return { total, rows, unallocated: Math.max(0, 100 - targeted), cashLeft: Math.max(cash, 0) - rows.reduce((s, r) => s + r.trade, 0) };
}
