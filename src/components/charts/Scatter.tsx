"use client";

import { useState } from "react";
import { fitTicks, Tooltip, useWidth } from "./common";

export interface ScatterPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

interface Props {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  height?: number;
  ariaLabel: string;
}

const PAD = { left: 56, right: 16, top: 12, bottom: 40 };

/** Points on two chosen axes, each labelled; axes hug the values (they needn't start at zero). A hidden table lists the points. */
export function Scatter({ points, xLabel, yLabel, formatX, formatY, height = 340, ariaLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<ScatterPoint>();
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xt = fitTicks(Math.min(...xs, 0), Math.max(...xs, 0));
  const yt = fitTicks(Math.min(...ys, 0), Math.max(...ys, 0));
  const [x0, x1] = [xt[0], xt[xt.length - 1]];
  const [y0, y1] = [yt[0], yt[yt.length - 1]];
  const w = Math.max(0, width - PAD.left - PAD.right);
  const h = height - PAD.top - PAD.bottom;
  const px = (v: number) => PAD.left + ((v - x0) / (x1 - x0 || 1)) * w;
  const py = (v: number) => PAD.top + h - ((v - y0) / (y1 - y0 || 1)) * h;

  return (
    <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(undefined)}>
      {width > 0 && points.length > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible text-[11px]">
          {yt.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD.left} x2={PAD.left + w} y1={py(v)} y2={py(v)} stroke="var(--glass-border)" strokeDasharray={v === 0 ? undefined : "2 4"} />
              <text x={PAD.left - 6} y={py(v)} dy="0.35em" textAnchor="end" className="fill-[var(--fg-muted)] tabular-nums">
                {formatY(v)}
              </text>
            </g>
          ))}
          {xt.map((v) => (
            <g key={`x${v}`}>
              <line x1={px(v)} x2={px(v)} y1={PAD.top} y2={PAD.top + h} stroke="var(--glass-border)" strokeDasharray={v === 0 ? undefined : "2 4"} />
              <text x={px(v)} y={PAD.top + h + 14} textAnchor="middle" className="fill-[var(--fg-muted)] tabular-nums">
                {formatX(v)}
              </text>
            </g>
          ))}
          <text x={PAD.left + w / 2} y={height - 4} textAnchor="middle" className="fill-fg font-medium">
            {xLabel}
          </text>
          <text transform={`translate(12 ${PAD.top + h / 2}) rotate(-90)`} textAnchor="middle" className="fill-fg font-medium">
            {yLabel}
          </text>
          {points.map((p) => (
            <g key={p.id} onPointerEnter={() => setHover(p)} opacity={!hover || hover.id === p.id ? 1 : 0.4}>
              <circle cx={px(p.x)} cy={py(p.y)} r={hover?.id === p.id ? 8 : 6} fill={p.color} stroke="var(--page)" strokeWidth={1.5} />
              <text x={px(p.x) + 9} y={py(p.y)} dy="0.35em" className="pointer-events-none fill-fg font-medium">
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      )}
      {hover && (
        <Tooltip x={px(hover.x)} y={py(hover.y) + 8} width={width}>
          <div className="font-medium">{hover.label}</div>
          <div className="mt-0.5 tabular-nums">
            {xLabel}: {formatX(hover.x)}
          </div>
          <div className="tabular-nums">
            {yLabel}: {formatY(hover.y)}
          </div>
        </Tooltip>
      )}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">{ariaLabel}</th>
            <th scope="col">{xLabel}</th>
            <th scope="col">{yLabel}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.id}>
              <td>{p.label}</td>
              <td>{formatX(p.x)}</td>
              <td>{formatY(p.y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
