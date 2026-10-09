import type { Flow } from "./aggregate";
import { centsToDecimal, safeText, toCsv } from "./csvText";

/** Names used by the Sankey chart for its middle node and the savings bands. */
export const FLOW_MIDDLE = "Budget";
export const FLOW_SAVED = "Saved";
export const FLOW_FROM_SAVINGS = "From savings";

/**
 * The bands behind the money-flow chart as rows: source → target → amount. Shares are of income
 * (or of spending when there was no income), like the chart's tooltips.
 */
export function flowRows(flow: Flow): { source: string; target: string; cents: number; share: number }[] {
  const income = flow.sources.reduce((a, s) => a + s.cents, 0);
  const spent = flow.sinks.reduce((a, s) => a + s.cents, 0);
  const base = income || spent || 1;
  const rows = [
    ...flow.sources.map((s) => ({ source: s.name, target: FLOW_MIDDLE, cents: s.cents })),
    ...(flow.fromSavings ? [{ source: FLOW_FROM_SAVINGS, target: FLOW_MIDDLE, cents: flow.fromSavings }] : []),
    ...flow.sinks.map((s) => ({ source: FLOW_MIDDLE, target: s.name, cents: s.cents })),
    ...(flow.saved ? [{ source: FLOW_MIDDLE, target: FLOW_SAVED, cents: flow.saved }] : []),
  ];
  return rows.filter((r) => r.cents > 0).map((r) => ({ ...r, share: Math.round((r.cents / base) * 1000) / 10 }));
}

/** CSV of the flow, safe to open in a spreadsheet (category names can't run as formulas). */
export function flowCsv(flow: Flow, currency: string): string {
  return toCsv([
    ["source", "target", "amount", "currency", "share_percent"],
    ...flowRows(flow).map((r) => [safeText(r.source), safeText(r.target), centsToDecimal(r.cents), currency, r.share]),
  ]);
}
