"use client";

import { useState } from "react";
import { categoryColor } from "@/lib/finance/format";

export interface DonutSlice {
  name: string;
  value: number;
  /** Palette slot 1–8; null renders the neutral "Other" grey unless `color` is set. */
  slot: number | null;
  color?: string | null;
  label: string;
}

const colorOf = (s: Pick<DonutSlice, "slot" | "color">) => categoryColor(s.slot, s.color);

/**
 * Donut with a 2px surface gap between slices, a centre total, and a legend that lists every
 * slice with its value (identity never relies on color alone; the legend doubles as the table view).
 */
export function Donut({
  slices,
  total,
  size = 132,
  compact,
  ariaLabel,
}: {
  slices: DonutSlice[];
  total: string;
  size?: number;
  /** Fewer legend rows (small spaces). */
  compact?: boolean;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number>();
  const sum = slices.reduce((a, s) => a + s.value, 0);
  const r = size / 2;
  const stroke = Math.max(14, size * 0.16);
  const radius = r - stroke / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 2 : 0;

  let offset = 0;
  const arcs = slices.map((s, i) => {
    const len = sum ? (s.value / sum) * circumference : 0;
    const arc = { i, s, dash: Math.max(len - gap, 0.5), offset };
    offset += len;
    return arc;
  });
  const focus = hover !== undefined ? slices[hover] : undefined;
  const legend = compact ? slices.slice(0, 4) : slices;

  if (!sum) return <p className="py-4 text-center text-sm text-muted">No spending in this period.</p>;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel} className="-rotate-90">
          {arcs.map((a) => (
            <circle
              key={a.s.name}
              cx={r}
              cy={r}
              r={radius}
              fill="none"
              stroke={colorOf(a.s)}
              strokeWidth={hover === a.i ? stroke + 4 : stroke}
              strokeDasharray={`${a.dash} ${circumference - a.dash}`}
              strokeDashoffset={-a.offset}
              opacity={hover === undefined || hover === a.i ? 1 : 0.45}
              onPointerEnter={() => setHover(a.i)}
              onPointerLeave={() => setHover(undefined)}
              className="transition-[opacity,stroke-width] duration-150"
            >
              <title>{`${a.s.name}: ${a.s.label} (${Math.round((a.s.value / sum) * 100)}%)`}</title>
            </circle>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-sm leading-tight font-semibold">{focus ? focus.label : total}</div>
            <div className="max-w-20 truncate text-[10px] text-muted">{focus ? focus.name : "spent"}</div>
          </div>
        </div>
      </div>
      <ul className="flex max-w-xs min-w-0 flex-1 flex-col gap-1 text-xs">
        {legend.map((s, i) => (
          <li
            key={s.name}
            className={`flex items-center gap-2 rounded-md px-1 ${hover === i ? "bg-hover" : ""}`}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(undefined)}
          >
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(s) }} />
            <span className="min-w-0 flex-1 truncate text-fg/90">{s.name}</span>
            <span className="shrink-0 tabular-nums text-muted">{s.label}</span>
          </li>
        ))}
        {compact && slices.length > legend.length && <li className="px-1 text-muted">+{slices.length - legend.length} more</li>}
      </ul>
    </div>
  );
}
