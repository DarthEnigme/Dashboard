"use client";

import { useState } from "react";
import { compact as fmt, Legend, niceTicks, Tooltip, useWidth } from "./common";

export interface BarGroup {
  label: string;
  /** One value per series, same order as `series`. */
  values: number[];
}

interface Props {
  groups: BarGroup[];
  series: { name: string; color: string }[];
  height?: number;
  format: (v: number) => string;
  ariaLabel: string;
}

const PAD = { top: 8, right: 4, bottom: 20, left: 40 };

/**
 * Grouped columns: <= 24px wide, 2px gap between neighbours, 4px rounded tops and square at the
 * baseline, one y-axis, per-group hover tooltip.
 */
export function Bars({ groups, series, height = 180, format, ariaLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const ticks = niceTicks(max * 1.05);
  const top = ticks[ticks.length - 1];
  const w = Math.max(width - PAD.left - PAD.right, 10);
  const h = height - PAD.top - PAD.bottom;
  const slot = w / Math.max(groups.length, 1);
  const barW = Math.min(24, Math.max(2, (slot * 0.7 - 2 * (series.length - 1)) / series.length));
  const groupW = barW * series.length + 2 * (series.length - 1);
  const y = (v: number) => PAD.top + h - (v / top) * h;
  const showLabel = (i: number) => groups.length <= 6 || i % 2 === (groups.length - 1) % 2;

  // Column with a 4px rounded data-end and a square base.
  const column = (x: number, v: number) => {
    const yy = y(v);
    const hh = PAD.top + h - yy;
    if (hh <= 0) return "";
    const rr = Math.min(4, barW / 2, hh);
    return `M${x},${PAD.top + h} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + barW - rr} Q${x + barW},${yy} ${x + barW},${yy + rr} V${PAD.top + h} Z`;
  };

  return (
    <div className="flex flex-col gap-2">
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />}
      <div ref={ref} className="relative" style={{ height }} onPointerLeave={() => setHover(undefined)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + w} y1={y(t)} y2={y(t)} stroke={t ? "var(--grid)" : "var(--axis)"} strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] tabular-nums">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {groups.map((g, i) => {
              const x0 = PAD.left + i * slot + (slot - groupW) / 2;
              return (
                <g key={g.label} onPointerEnter={() => setHover(i)} opacity={hover === undefined || hover === i ? 1 : 0.5}>
                  {/* Hit target: the whole slot, larger than the bars. */}
                  <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={h} fill="transparent" />
                  {g.values.map((v, k) => (
                    <path key={k} d={column(x0 + k * (barW + 2), v)} fill={series[k].color} />
                  ))}
                  {showLabel(i) && (
                    <text x={PAD.left + i * slot + slot / 2} y={height - 5} textAnchor="middle" className="fill-muted text-[10px]">
                      {g.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {hover !== undefined && (
          <Tooltip x={PAD.left + hover * slot + slot / 2} y={PAD.top} width={width}>
            <div className="mb-1 text-muted">{groups[hover].label}</div>
            {series.map((s, k) => (
              <div key={s.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="font-medium tabular-nums">{format(groups[hover].values[k])}</span>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}
