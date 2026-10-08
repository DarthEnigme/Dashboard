"use client";

import { useState } from "react";
import { compact, Legend, niceRange, Tooltip, useWidth } from "./common";

export interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
  /** Dashed: estimates (a projection) rather than measurements. */
  dashed?: boolean;
}

interface Props {
  x: number[];
  series: LineSeries[];
  height?: number;
  unit?: string;
  formatX: (t: number) => string;
  /** Wash under a single series. */
  area?: boolean;
  ariaLabel: string;
}

const PAD = { top: 10, right: 12, bottom: 22, left: 44 };

/** Time-series line chart: one y-axis, 2px lines, crosshair + tooltip on hover. */
export function LineChart({ x, series, height = 220, unit = "", formatX, area, ariaLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  // A little headroom so peaks never touch the edges; below zero only when a value is.
  const hi = all.length ? Math.max(...all) : 1;
  const lo = all.length ? Math.min(...all) : 0;
  const ticks = niceRange(lo < 0 ? lo * 1.08 : 0, hi > 0 ? hi * 1.08 : 0.01);
  const min = ticks[0];
  const max = ticks[ticks.length - 1];
  const w = Math.max(width - PAD.left - PAD.right, 10);
  const h = height - PAD.top - PAD.bottom;
  const px = (i: number) => PAD.left + (x.length > 1 ? (i / (x.length - 1)) * w : w / 2);
  const py = (v: number) => PAD.top + h - ((v - min) / (max - min)) * h;

  // Break lines at gaps (null values) instead of interpolating across them.
  const path = (values: (number | null)[]) =>
    values
      .map((v, i) => (v === null ? null : `${i && values[i - 1] !== null ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (x.length - 1));
    setHover(Math.min(Math.max(i, 0), x.length - 1));
  };

  const xLabels = [0, Math.floor((x.length - 1) / 2), x.length - 1];

  return (
    <div className="flex flex-col gap-2">
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.dashed ? `${s.name} (dashed)` : s.name, color: s.color, line: true }))} />}
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + w} y1={py(t)} y2={py(t)} stroke={t ? "var(--grid)" : "var(--axis)"} strokeWidth={1} />
                <text x={PAD.left - 8} y={py(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[10px] tabular-nums">
                  {compact(t)}
                  {t === max ? unit : ""}
                </text>
              </g>
            ))}
            {xLabels.map((i, k) => (
              <text
                key={k}
                x={px(i)}
                y={height - 6}
                textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
                className="fill-muted text-[10px]"
              >
                {x[i] !== undefined ? formatX(x[i]) : ""}
              </text>
            ))}
            {area && series[0] && (
              <path
                d={`${path(series[0].values)} V${py(Math.max(min, 0))} H${px(series[0].values.findIndex((v) => v !== null))} Z`}
                fill={series[0].color}
                opacity={0.1}
              />
            )}
            {series.map((s) => (
              <g key={s.name}>
                <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : undefined} />
                {/* A value with no neighbours draws no line: show it as a dot. */}
                {s.values.map((v, i) =>
                  v !== null && (s.values[i - 1] ?? null) === null && (s.values[i + 1] ?? null) === null ? (
                    <circle key={i} cx={px(i)} cy={py(v)} r={2.5} fill={s.color} />
                  ) : null,
                )}
              </g>
            ))}
            {hover !== undefined && (
              <g>
                <line x1={px(hover)} x2={px(hover)} y1={PAD.top} y2={PAD.top + h} stroke="var(--axis)" strokeWidth={1} />
                {series.map((s) =>
                  s.values[hover] === null ? null : (
                    <circle key={s.name} cx={px(hover)} cy={py(s.values[hover]!)} r={4} fill={s.color} stroke="var(--page)" strokeWidth={2} />
                  ),
                )}
              </g>
            )}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={w}
              height={h}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(undefined)}
            />
          </svg>
        )}
        {hover !== undefined && (
          <Tooltip x={px(hover)} y={PAD.top} width={width}>
            <div className="mb-1 text-muted">{formatX(x[hover])}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="font-medium tabular-nums">{s.values[hover] === null ? "no data" : `${compact(s.values[hover]!)}${unit}`}</span>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </div>
  );
}
