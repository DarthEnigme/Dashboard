"use client";

import { useId, useMemo, useState } from "react";
import type { Flow } from "@/lib/finance/aggregate";
import { categoryColor, money } from "@/lib/finance/format";
import { FLOW_FROM_SAVINGS, FLOW_MIDDLE, FLOW_SAVED } from "@/lib/finance/flowCsv";
import { Tooltip, useWidth } from "./common";
import { foldSmall, layoutSankey, placeLabels, type FlowItem } from "./sankeyLayout";

const TOP = 20; // room for the middle node's label
const SAVED = FLOW_SAVED;
const FROM_SAVINGS = FLOW_FROM_SAVINGS;

/**
 * Money flow for a period: income sources → the period's budget → spending categories, with what
 * was left over ("Saved", or "From savings" when spending was higher). Hovering a node or band
 * dims the rest; every node is labelled and a hidden table lists the numbers.
 */
export function Sankey({ flow, currency, height = 260, ariaLabel = "Where the money came from and where it went" }: { flow: Flow; currency: string; height?: number; ariaLabel?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ index: number; x: number; y: number }>();
  // Savings are not a category: a neutral hatch keeps them apart from the eight category colours.
  const hatchId = `hatch-${useId().replace(/:/g, "")}`;
  const hatch = `url(#${hatchId})`;
  const compact = width < 440;
  const nodeWidth = compact ? 8 : 10;

  const { sources, sinks, income, spent } = useMemo(() => {
    const src: FlowItem[] = flow.sources.map((s) => ({ name: s.name, value: s.cents, color: categoryColor(s.slot, s.color) }));
    const snk = foldSmall(
      flow.sinks.map((s) => ({ name: s.name, value: s.cents, color: categoryColor(s.slot, s.color) })),
      0.02,
      categoryColor(null),
    );
    if (flow.fromSavings) src.push({ name: FROM_SAVINGS, value: flow.fromSavings, color: hatch });
    if (flow.saved) snk.push({ name: SAVED, value: flow.saved, color: hatch });
    return {
      sources: src,
      sinks: snk,
      income: flow.sources.reduce((a, s) => a + s.cents, 0),
      spent: flow.sinks.reduce((a, s) => a + s.cents, 0),
    };
  }, [flow, hatch]);

  const layout = useMemo(
    () => layoutSankey(sources, { name: FLOW_MIDDLE, color: "var(--fg)" }, sinks, { width, height, nodeWidth, gap: compact ? 6 : 8 }),
    [sources, sinks, width, height, nodeWidth, compact],
  );

  // Every outer node gets a label: two lines (name + amount) when the node is tall enough, spread
  // apart where small nodes sit close together.
  const fontSize = compact ? 10 : 11;
  const labelY = new Map<number, { y: number; lines: number }>();
  for (const side of ["source", "sink"] as const) {
    const idx = layout.nodes.flatMap((n, i) => (n.side === side ? [i] : []));
    const specs = idx.map((i) => ({ y: layout.nodes[i].y, h: layout.nodes[i].h, lines: !compact && layout.nodes[i].h >= fontSize * 2.4 ? 2 : 1 }));
    placeLabels(specs, fontSize + 1, height).forEach((y, k) => labelY.set(idx[k], { y, lines: specs[k].lines }));
  }

  if (!income && !spent) return <p className="py-6 text-center text-sm text-muted">No income or spending in this period.</p>;

  const base = income || spent;
  const share = (v: number) => `${Math.round((v / base) * 100)}% of ${income ? "income" : "spending"}`;
  const focus = hover ? layout.nodes[hover.index] : undefined;
  const lit = (i: number) => hover === undefined || hover.index === i || focus?.side === "middle";
  const track = (index: number) => (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    setHover({ index, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(undefined)}>
      {width > 0 && (
        <svg width={width} height={height + TOP} role="img" aria-label={ariaLabel} className="block overflow-visible">
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--fg)" opacity="0.1" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--fg)" strokeWidth="2.5" opacity="0.5" />
            </pattern>
          </defs>
          <g transform={`translate(0 ${TOP})`}>
            {layout.links.map((l) => (
              <path
                key={l.node}
                d={l.path}
                fill={l.color}
                opacity={lit(l.node) ? (hover ? 0.55 : 0.32) : 0.08}
                onPointerMove={track(l.node)}
                className="transition-opacity duration-150"
              />
            ))}
            {layout.nodes.map((n, i) => {
              const labelX = n.side === "source" ? n.x + nodeWidth + 6 : n.side === "sink" ? n.x - 6 : n.x + nodeWidth / 2;
              const anchor = n.side === "source" ? "start" : n.side === "sink" ? "end" : "middle";
              const label = labelY.get(i);
              const showName = !!label;
              const showValue = label?.lines === 2;
              const cy = label?.y ?? n.y + n.h / 2;
              return (
                <g key={`${n.side}-${n.name}`} opacity={lit(i) ? 1 : 0.35} onPointerMove={track(i)} className="transition-opacity duration-150">
                  <rect x={n.x} y={n.y} width={nodeWidth} height={Math.max(n.h, 1)} rx={2} fill={n.color} />
                  {/* Wider invisible hit target than the 10px node. */}
                  <rect x={n.x - 6} y={n.y} width={22} height={Math.max(n.h, 6)} fill="transparent" />
                  {showName && (
                    <text x={labelX} y={showValue ? cy - 1 : cy} dy={showValue ? 0 : "0.35em"} textAnchor={anchor} fontSize={fontSize} className="pointer-events-none fill-fg">
                      {n.name}
                    </text>
                  )}
                  {showValue && (
                    <text x={labelX} y={cy + fontSize + 1} textAnchor={anchor} fontSize={fontSize} className="pointer-events-none fill-[var(--fg-muted)] tabular-nums">
                      {money(n.value, currency)}
                    </text>
                  )}
                  {n.side === "middle" && (
                    <text x={labelX} y={n.y - 8} textAnchor="middle" fontSize={fontSize} className="pointer-events-none fill-[var(--fg-muted)] tabular-nums">
                      {money(n.value, currency)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {hover && focus && (
        <Tooltip x={hover.x} y={hover.y + 8} width={width}>
          <div className="flex items-center gap-2 font-medium">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ background: focus.color === hatch ? "repeating-linear-gradient(45deg, var(--fg-muted) 0 2px, transparent 2px 4px)" : focus.color }}
            />
            {focus.side === "middle" ? (income ? "Income" : "Spending") : focus.name}
          </div>
          <div className="mt-0.5 flex justify-between gap-4 tabular-nums">
            <span>{money(focus.value, currency)}</span>
            {focus.side !== "middle" && <span className="text-muted">{share(focus.value)}</span>}
          </div>
        </Tooltip>
      )}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Flow</th>
            <th scope="col">Name</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {[...sources.map((s) => ["In", s] as const), ...sinks.map((s) => ["Out", s] as const)].map(([dir, s]) => (
            <tr key={`${dir}-${s.name}`}>
              <td>{dir}</td>
              <td>{s.name}</td>
              <td>{money(s.value, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
