"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Width of a container, for drawing SVG in real pixels (crisp 1px gridlines, unscaled text). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round axis maximum and ~4 evenly spaced ticks (1/2/5 × 10^k steps). */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Thousands-comma'd, compact past 10k: 1,234 / 12.9K / 4.2M / 5.4G. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}G`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

export interface LegendItem {
  label: string;
  color: string;
  value?: string;
  /** Line key instead of a square swatch. */
  line?: boolean;
}

/** Legend for 2+ series; identity is never carried by color alone. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={i.line ? "h-0.5 w-3.5 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"}
            style={{ background: i.color }}
          />
          <span className="text-fg/90">{i.label}</span>
          {i.value && <span className="tabular-nums">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Hover card positioned within a relative container. */
export function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 12, 0), width - 170);
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-36 rounded-xl border border-line px-3 py-2 text-xs shadow-xl"
      style={{ left, top: Math.max(0, y), background: "var(--dialog)", backdropFilter: "blur(12px)" }}
    >
      {children}
    </div>
  );
}
