import type { StocksData } from "./types";

/**
 * What a portfolio is made of, as Sankey columns: portfolios (when several are shown together) →
 * sectors → holdings, by today's value. Holdings too small to read are gathered per sector.
 * Pure, and in the chart's terms (nodes and links), so it can be checked by hand.
 */

export interface FlowNode {
  id: string;
  name: string;
  layer: number;
  value: number;
  color: string;
}
export interface FlowLink {
  source: string;
  target: string;
  value: number;
  color: string;
}

const color = (i: number) => `var(--series-${(i % 8) + 1})`;

export function composition(data: Pick<StocksData, "positions" | "byPortfolio" | "portfolios">, labels: { unclassified: string; other: string }, minShare = 0.015): { nodes: FlowNode[]; links: FlowLink[] } {
  const total = data.positions.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return { nodes: [], links: [] };
  const sectorOf = new Map(data.positions.map((p) => [p.symbol, p.sector ?? labels.unclassified]));
  const sectors = [...new Set(data.positions.map((p) => sectorOf.get(p.symbol)!))]
    .map((name) => ({ name, value: data.positions.filter((p) => sectorOf.get(p.symbol) === name).reduce((s, p) => s + p.value, 0) }))
    .sort((a, b) => b.value - a.value);
  const sectorColor = new Map(sectors.map((s, i) => [s.name, color(i)]));
  // A holding below the threshold joins its sector's "other".
  const holdingId = (symbol: string) => (data.positions.find((p) => p.symbol === symbol)!.value / total < minShare ? `other:${sectorOf.get(symbol)}` : `h:${symbol}`);

  const withPortfolios = data.byPortfolio.length > 0;
  const shift = withPortfolios ? 1 : 0;
  const nodes: FlowNode[] = [];
  const links = new Map<string, FlowLink>();
  const link = (source: string, target: string, value: number, c: string) => {
    const key = `${source}>${target}`;
    const l = links.get(key);
    if (l) l.value += value;
    else links.set(key, { source, target, value, color: c });
  };

  if (withPortfolios) {
    data.portfolios.forEach((p) => {
      const value = data.byPortfolio.filter((x) => x.portfolio === p.id).reduce((s, x) => s + x.value, 0);
      if (value > 0) nodes.push({ id: `p:${p.id}`, name: p.name, layer: 0, value, color: "var(--accent)" });
    });
    for (const x of data.byPortfolio) if (x.value > 0) link(`p:${x.portfolio}`, `s:${sectorOf.get(x.symbol) ?? labels.unclassified}`, x.value, sectorColor.get(sectorOf.get(x.symbol) ?? "") ?? "var(--accent)");
  }
  for (const s of sectors) nodes.push({ id: `s:${s.name}`, name: s.name, layer: shift, value: s.value, color: sectorColor.get(s.name)! });

  const holdings = new Map<string, FlowNode>();
  for (const p of [...data.positions].sort((a, b) => sectors.findIndex((s) => s.name === sectorOf.get(a.symbol)) - sectors.findIndex((s) => s.name === sectorOf.get(b.symbol)) || b.value - a.value)) {
    const id = holdingId(p.symbol);
    const sector = sectorOf.get(p.symbol)!;
    const node = holdings.get(id) ?? { id, name: id.startsWith("other:") ? labels.other : p.symbol, layer: shift + 1, value: 0, color: sectorColor.get(sector)! };
    node.value += p.value;
    holdings.set(id, node);
    link(`s:${sector}`, id, p.value, sectorColor.get(sector)!);
  }
  // Each sector's "other" goes last within the sector.
  const ordered = [...holdings.values()].sort((a, b) => {
    const sa = sectors.findIndex((s) => links.has(`s:${s.name}>${a.id}`));
    const sb = sectors.findIndex((s) => links.has(`s:${s.name}>${b.id}`));
    return sa - sb || Number(a.id.startsWith("other:")) - Number(b.id.startsWith("other:")) || b.value - a.value;
  });
  return { nodes: [...nodes, ...ordered], links: [...links.values()] };
}
