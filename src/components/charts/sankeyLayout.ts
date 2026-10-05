/**
 * Layout for a three-column money-flow Sankey: sources → one middle node → sinks.
 * Pure (no DOM), so it can be unit tested; Sankey.tsx draws it.
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

export function layoutSankey(
  sources: FlowItem[],
  middle: Omit<FlowItem, "value">,
  sinks: FlowItem[],
  opts: { width: number; height: number; nodeWidth?: number; gap?: number },
): SankeyLayout {
  const { width, height, nodeWidth = 10, gap = 8 } = opts;
  const sum = (xs: FlowItem[]) => xs.reduce((a, i) => a + i.value, 0);
  const total = Math.max(sum(sources), sum(sinks));
  if (!total || width <= 0 || height <= 0) return { nodes: [], links: [] };

  // One scale for every column, so a band is equally thick at both ends.
  const usable = (n: number) => height - gap * Math.max(0, n - 1);
  const k = Math.max(0, Math.min(usable(sources.length), usable(sinks.length), height) / total);

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const midX = (width - nodeWidth) / 2;
  const midH = total * k;
  const midY = (height - midH) / 2;

  const column = (items: FlowItem[], side: "source" | "sink") => {
    const x = side === "source" ? 0 : width - nodeWidth;
    const colH = sum(items) * k + gap * Math.max(0, items.length - 1);
    let y = (height - colH) / 2;
    // Bands meet the middle node stacked in the same order, without gaps.
    let midOffset = midY + (midH - sum(items) * k) / 2;
    for (const item of items) {
      const h = item.value * k;
      const index = nodes.push({ ...item, side, x, y, h }) - 1;
      const path =
        side === "source"
          ? bandPath(x + nodeWidth, y, midX, midOffset, h)
          : bandPath(midX + nodeWidth, midOffset, x, y, h);
      links.push({ node: index, value: item.value, color: item.color, path });
      y += h + gap;
      midOffset += h;
    }
  };
  column(sources, "source");
  column(sinks, "sink");
  nodes.push({ ...middle, value: total, side: "middle", x: midX, y: midY, h: midH });
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
