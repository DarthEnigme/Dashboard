/**
 * Sankey layouts: any number of columns joined by bands (`layoutLayers`), and the money-flow one
 * built on it (sources → one middle node → sinks). Pure (no DOM), so they can be unit tested.
 */

export interface FlowItem {
  name: string;
  value: number;
  /** CSS colour of the node and its band. */
  color: string;
}

export interface SankeyNode extends FlowItem {
  side: "source" | "middle" | "sink";
  x: number;
  y: number;
  h: number;
}

export interface SankeyLink {
  /** Index into nodes of the outer (source or sink) end. */
  node: number;
  value: number;
  color: string;
  /** Closed band path. */
  path: string;
}

export interface SankeyLayout {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

/**
 * Fold items below `minShare` of the total into one "Other" item (summed with any existing
 * "Other"), keeping the rest in order. Tiny bands are unreadable and their labels collide.
 */
export function foldSmall(items: FlowItem[], minShare: number, otherColor: string, otherName = "Other"): FlowItem[] {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!total) return [];
  const keep: FlowItem[] = [];
  let other = 0;
  for (const i of items) {
    if (i.value <= 0) continue;
    if (i.name === otherName || i.value / total < minShare) other += i.value;
    else keep.push(i);
  }
  return other > 0 ? [...keep, { name: otherName, value: other, color: otherColor }] : keep;
}

/** A band of constant thickness from (x0, y0..y0+t) to (x1, y1..y1+t), curved horizontally. */
export function bandPath(x0: number, y0: number, x1: number, y1: number, t: number): string {
  const xm = (x0 + x1) / 2;
  const f = (n: number) => Math.round(n * 10) / 10;
  return [
    `M${f(x0)},${f(y0)}`,
    `C${f(xm)},${f(y0)} ${f(xm)},${f(y1)} ${f(x1)},${f(y1)}`,
    `L${f(x1)},${f(y1 + t)}`,
    `C${f(xm)},${f(y1 + t)} ${f(xm)},${f(y0 + t)} ${f(x0)},${f(y0 + t)}`,
    "Z",
  ].join(" ");
}

// ---------- any number of columns ----------

export interface LayerNode extends FlowItem {
  id: string;
  /** Column, from 0 on the left. */
  layer: number;
}
export interface LayerLink {
  source: string;
  target: string;
  value: number;
  color: string;
}
export interface PlacedNode extends LayerNode {
  x: number;
  y: number;
  h: number;
}
export interface PlacedLink extends LayerLink {
  path: string;
}

/**
 * A Sankey of columns (layers) joined by links from one column to the next, e.g. portfolios →
 * sectors → holdings. Nodes keep the order given within their column; one scale serves every
 * column, so a band is equally thick at both ends; a node is as tall as the larger of what comes
 * in and what goes out, and its bands are stacked, centred, in the order of the nodes at their
 * other end (so they don't cross more than needed).
 */
export function layoutLayers(nodes: LayerNode[], links: LayerLink[], opts: { width: number; height: number; nodeWidth?: number; gap?: number }): { nodes: PlacedNode[]; links: PlacedLink[] } {
  const { width, height, nodeWidth = 10, gap = 8 } = opts;
  const layers = [...new Set(nodes.map((n) => n.layer))].sort((a, b) => a - b);
  const inLayer = (l: number) => nodes.filter((n) => n.layer === l);
  const sum = (xs: { value: number }[]) => xs.reduce((a, i) => a + i.value, 0);
  const total = Math.max(0, ...layers.map((l) => sum(inLayer(l))));
  if (!total || width <= 0 || height <= 0 || !layers.length) return { nodes: [], links: [] };

  const usable = Math.min(...layers.map((l) => height - gap * Math.max(0, inLayer(l).length - 1)));
  const k = Math.max(0, Math.min(usable, height) / total);
  const span = layers.length > 1 ? (width - nodeWidth) / (layers.length - 1) : 0;

  const placed = new Map<string, PlacedNode>();
  layers.forEach((l, i) => {
    const column = inLayer(l);
    let y = (height - (sum(column) * k + gap * Math.max(0, column.length - 1))) / 2;
    for (const n of column) {
      const h = n.value * k;
      placed.set(n.id, { ...n, x: i * span, y, h });
      y += h + gap;
    }
  });

  // Where each band leaves its source and reaches its target: stacked in the order of the other ends, centred on the node.
  const offsets = (side: "source" | "target") => {
    const other = side === "source" ? "target" : "source";
    const at = new Map<LayerLink, number>();
    for (const node of placed.values()) {
      const mine = links.filter((x) => x[side] === node.id && placed.has(x[other])).sort((a, b) => placed.get(a[other])!.y - placed.get(b[other])!.y);
      let y = node.y + (node.h - sum(mine) * k) / 2;
      for (const link of mine) {
        at.set(link, y);
        y += link.value * k;
      }
    }
    return at;
  };
  const from = offsets("source");
  const to = offsets("target");
  return {
    nodes: [...placed.values()],
    links: links.flatMap((link) => {
      const a = placed.get(link.source);
      const b = placed.get(link.target);
      if (!a || !b) return [];
      return [{ ...link, path: bandPath(a.x + nodeWidth, from.get(link)!, b.x, to.get(link)!, link.value * k) }];
    }),
  };
}

/** The money-flow Sankey: sources → one middle node → sinks, as three columns. */
export function layoutSankey(
  sources: FlowItem[],
  middle: Omit<FlowItem, "value">,
  sinks: FlowItem[],
  opts: { width: number; height: number; nodeWidth?: number; gap?: number },
): SankeyLayout {
  const sum = (xs: FlowItem[]) => xs.reduce((a, i) => a + i.value, 0);
  const total = Math.max(sum(sources), sum(sinks));
  const MID = "middle";
  const src = sources.map((s, i) => ({ ...s, id: `s${i}`, layer: 0 }));
  const snk = sinks.map((s, i) => ({ ...s, id: `t${i}`, layer: 2 }));
  const layout = layoutLayers(
    [...src, { ...middle, value: total, id: MID, layer: 1 }, ...snk],
    [...src.map((s) => ({ source: s.id, target: MID, value: s.value, color: s.color })), ...snk.map((s) => ({ source: MID, target: s.id, value: s.value, color: s.color }))],
    opts,
  );
  if (!layout.nodes.length) return { nodes: [], links: [] };
  // Sources, then sinks, then the middle: each link points at its outer end.
  const outer = [...layout.nodes.filter((n) => n.layer === 0), ...layout.nodes.filter((n) => n.layer === 2)];
  const nodes: SankeyNode[] = [...outer, layout.nodes.find((n) => n.id === MID)!].map((n) => ({ name: n.name, value: n.value, color: n.color, x: n.x, y: n.y, h: n.h, side: n.layer === 0 ? "source" : n.layer === 2 ? "sink" : "middle" }));
  const links = layout.links.map((l) => {
    const end = l.source === MID ? l.target : l.source;
    return { node: outer.findIndex((n) => n.id === end), value: l.value, color: l.color, path: l.path };
  });
  return { nodes, links };
}

/**
 * Label centres for one column: each label wants the middle of its node, labels never overlap
 * (`size` each, `lines` tall), and they stay within [0, height]. Classic one-pass push-down,
 * then a push-up pass from the bottom edge.
 */
export function placeLabels(nodes: { y: number; h: number; lines: number }[], size: number, height: number): number[] {
  const want = nodes.map((n) => n.y + n.h / 2);
  const half = (i: number) => (nodes[i].lines * size + 2) / 2;
  const out = [...want];
  for (let i = 0; i < out.length; i++) {
    const min = i === 0 ? half(0) : out[i - 1] + half(i - 1) + half(i);
    out[i] = Math.max(out[i], min);
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const max = i === out.length - 1 ? height - half(i) : out[i + 1] - half(i + 1) - half(i);
    out[i] = Math.min(out[i], max);
  }
  return out;
}
