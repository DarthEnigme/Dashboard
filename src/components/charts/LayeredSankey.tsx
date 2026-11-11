"use client";

import { useMemo, useState } from "react";
import { Tooltip, useWidth } from "./common";
import { layoutLayers, placeLabels, type LayerLink, type LayerNode } from "./sankeyLayout";

interface Props {
  nodes: LayerNode[];
  links: LayerLink[];
  /** How a value is written (an amount, a share…). */
  format: (value: number) => string;
  /** The part of the whole, for the tooltip ("12 %"). */
  share?: (value: number) => string;
  height?: number;
  ariaLabel: string;
  /** Headings above the columns, left to right. */
  columns?: string[];
}

/**
 * A Sankey of any number of columns (e.g. portfolios → sectors → holdings). Hovering a node or a
 * band dims what isn't joined to it; labels sit outside the first and last columns and beside the
 * middle ones, spread so they never overlap; a hidden table lists every band.
 */
export function LayeredSankey({ nodes, links, format, share, height = 320, ariaLabel, columns }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ id: string; x: number; y: number }>();
  const compact = width < 520;
  const nodeWidth = compact ? 8 : 10;
  const fontSize = compact ? 10 : 11;
  const top = columns ? 22 : 4;
  // Room for the outer labels: the drawing is inset on both sides.
  const inset = compact ? 70 : 120;
  const layout = useMemo(() => layoutLayers(nodes, links, { width: Math.max(0, width - 2 * inset), height, nodeWidth }), [nodes, links, width, inset, height, nodeWidth]);
  const layers = [...new Set(layout.nodes.map((n) => n.layer))].sort((a, b) => a - b);
  const last = layers[layers.length - 1];

  const labelY = useMemo(() => {
    const out = new Map<string, number>();
    for (const l of layers) {
      const column = layout.nodes.filter((n) => n.layer === l);
      // Labels of nodes too thin to read are left to the tooltip.
      const shown = column.filter((n) => n.h >= 3);
      placeLabels(
        shown.map((n) => ({ y: n.y, h: n.h, lines: 1 })),
        fontSize + 2,
        height,
      ).forEach((y, i) => out.set(shown[i].id, y));
    }
    return out;
  }, [layout, layers, fontSize, height]);

  // What hovering lights up: the node or band itself, and what it is joined to.
  const joined = useMemo(() => {
    if (!hover) return undefined;
    const lit = new Set([hover.id]);
    for (const l of links) if (l.source === hover.id || l.target === hover.id || `${l.source}>${l.target}` === hover.id) [l.source, l.target, `${l.source}>${l.target}`].forEach((x) => lit.add(x));
    return lit;
  }, [hover, links]);
  const lit = (id: string) => !joined || joined.has(id);
  const track = (id: string) => (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    setHover({ id, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const focusNode = hover && layout.nodes.find((n) => n.id === hover.id);
  const focusLink = hover && !focusNode ? layout.links.find((l) => `${l.source}>${l.target}` === hover.id) : undefined;
  const name = (id: string) => nodes.find((n) => n.id === id)?.name ?? id;

  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(undefined)}>
      {width > 0 && (
        <svg width={width} height={height + top} role="img" aria-label={ariaLabel} className="block overflow-visible">
          <g transform={`translate(${inset} ${top})`}>
            {columns &&
              layers.map((l, i) => {
                const x = layout.nodes.find((n) => n.layer === l)!.x + nodeWidth / 2;
                return (
                  <text key={l} x={x} y={-10} textAnchor={i === 0 ? "start" : i === layers.length - 1 ? "end" : "middle"} fontSize={fontSize} className="fill-[var(--fg-muted)] font-medium uppercase">
                    {columns[i]}
                  </text>
                );
              })}
            {layout.links.map((l) => {
              const id = `${l.source}>${l.target}`;
              return <path key={id} d={l.path} fill={l.color} opacity={lit(id) ? (hover ? 0.55 : 0.3) : 0.07} onPointerMove={track(id)} className="transition-opacity duration-150" />;
            })}
            {layout.nodes.map((n) => {
              const outerLeft = n.layer === layers[0];
              const outerRight = n.layer === last && layers.length > 1;
              const x = outerLeft ? n.x - 6 : outerRight ? n.x + nodeWidth + 6 : n.x + nodeWidth + 4;
              const anchor = outerLeft ? "end" : "start";
              const y = labelY.get(n.id);
              return (
                <g key={n.id} opacity={lit(n.id) ? 1 : 0.35} onPointerMove={track(n.id)} className="transition-opacity duration-150">
                  <rect x={n.x} y={n.y} width={nodeWidth} height={Math.max(n.h, 1)} rx={2} fill={n.color} />
                  <rect x={n.x - 6} y={n.y} width={nodeWidth + 12} height={Math.max(n.h, 6)} fill="transparent" />
                  {y !== undefined && (
                    <text x={x} y={y} dy="0.35em" textAnchor={anchor} fontSize={fontSize} className="pointer-events-none fill-fg">
                      {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hover && (focusNode || focusLink) && (
        <Tooltip x={hover.x} y={hover.y + 8} width={width}>
          <div className="flex items-center gap-2 font-medium">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: (focusNode ?? focusLink)!.color }} />
            {focusNode ? focusNode.name : `${name(focusLink!.source)} → ${name(focusLink!.target)}`}
          </div>
          <div className="mt-0.5 flex justify-between gap-4 tabular-nums">
            <span>{format((focusNode ?? focusLink)!.value)}</span>
            {share && <span className="text-muted">{share((focusNode ?? focusLink)!.value)}</span>}
          </div>
        </Tooltip>
      )}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {links.map((l) => (
            <tr key={`${l.source}>${l.target}`}>
              <td>{name(l.source)}</td>
              <td>{name(l.target)}</td>
              <td>{format(l.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
