import { latestOf, measure, periodName, seriesOf, type Period, type SymbolFacts } from "./metrics";
import type { Position, Snapshot, Transaction } from "./types";

/**
 * The Stocks app's numbers as tables (a header row, then one row each), for CSV, XLSX or JSON.
 * Pure: the route gathers the data, these lay it out.
 */

export type Table = (string | number | null)[][];

/** The columns NanoDash's own import preset reads, so an export imports back unchanged. */
export const TRANSACTION_COLUMNS = ["date", "symbol", "kind", "quantity", "price", "fees", "currency", "note", "portfolio", "id"];

export function transactionsTable(transactions: Transaction[], portfolioName: (id: number) => string): Table {
  // Oldest first reads better in a spreadsheet.
  const rows = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return [TRANSACTION_COLUMNS, ...rows.map((t) => [t.date, t.symbol, t.kind, t.quantity, t.price, t.fees, t.currency, t.note ?? "", portfolioName(t.portfolio_id), t.external_id ?? `tx:${t.id}`])];
}

export function positionsTable(data: Snapshot): Table {
  const header = ["symbol", "name", "sector", "quote currency", "quantity", "average cost", "price", `value (${data.currency})`, `cost (${data.currency})`, `gain (${data.currency})`, "gain %", `realized (${data.currency})`, `dividends (${data.currency})`, "weight %", "status"];
  const row = (p: Position, status: string) => [p.symbol, p.name, p.sector ?? "", p.currency, p.quantity, p.avgCost, p.price, p.value, p.cost, p.gain, p.gainPct, p.realized, p.dividends, p.weight * 100, status];
  return [header, ...data.positions.map((p) => row(p, "held")), ...data.closed.map((p) => row(p, "sold"))];
}

export function dividendsTable(data: Snapshot): Table {
  return [["day", "symbol", `amount (${data.currency})`], ...[...data.dividendList].reverse().map((d) => [d.day, d.symbol, d.amount])];
}

/**
 * Chosen measures of chosen symbols: one row per symbol and period (yearly or quarterly), then a
 * "latest" row per symbol with today's value of every measure (P/E, price… only have that one).
 */
export function figuresTable(facts: (SymbolFacts & { name: string })[], ids: string[], period: Period): Table {
  const known = ids.filter((id) => measure(id));
  const header = ["symbol", "name", "period", ...known.map((id) => measure(id)!.label)];
  const rows: Table = [];
  for (const f of facts) {
    const series = known.map((id) => new Map(seriesOf(id, f, period).map((p) => [periodName(p.day, period), p.value])));
    const periods = [...new Set(known.flatMap((id) => seriesOf(id, f, period).map((p) => p.day)))].sort().map((d) => periodName(d, period));
    for (const name of [...new Set(periods)]) rows.push([f.symbol, f.name, name, ...series.map((s) => s.get(name) ?? null)]);
    rows.push([f.symbol, f.name, "latest", ...known.map((id) => latestOf(id, f))]);
  }
  return [header, ...rows];
}
