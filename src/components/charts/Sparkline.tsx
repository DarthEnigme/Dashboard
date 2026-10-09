"use client";

import { useState } from "react";
import type { WidgetSpark } from "@/integrations/types";
import { useT } from "@/i18n/client";
import { formatLocale } from "@/i18n/format";
import { useWidth } from "./common";

const HEIGHT = 36;
const PAD = 3;

const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString(formatLocale()) : n.toFixed(1));

/** One metric's recent trend: 2px line with a light wash, crosshair and value on hover. */
export function Sparkline({ spark }: { spark: WidgetSpark }) {
  const t = useT();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const { values } = spark;
  const top = spark.max ?? (Math.max(...values, 0) * 1.1 || 1);
  const px = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * width : width / 2);
  const py = (v: number) => PAD + (HEIGHT - 2 * PAD) * (1 - Math.min(v, top) / top);
  const line = values.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const shown = hover === undefined ? spark.current : `${fmt(values[hover])}${spark.unit ?? ""}`;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(Math.max(Math.round(((e.clientX - r.left) / r.width) * (values.length - 1)), 0), values.length - 1));
  };

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[10px] font-medium tracking-wide uppercase">
        <span className="truncate text-muted">{spark.label}</span>
        <span className="text-xs font-semibold text-fg tabular-nums normal-case">{shown}</span>
      </div>
      {/* Sits above the card's stretched title link so hovering works. */}
      <div ref={ref} className="relative z-10" style={{ height: HEIGHT }}>
        {width > 0 && values.length > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={t("{label}, latest {value}", { label: spark.label, value: spark.current })} className="overflow-visible">
            <line x1={0} x2={width} y1={HEIGHT - PAD} y2={HEIGHT - PAD} stroke="var(--axis)" strokeWidth={1} />
            <path d={`${line} L${px(values.length - 1)},${HEIGHT - PAD} L${px(0)},${HEIGHT - PAD} Z`} fill="var(--series-1)" opacity={0.14} />
            <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== undefined && (
              <>
                <line x1={px(hover)} x2={px(hover)} y1={0} y2={HEIGHT} stroke="var(--axis)" strokeWidth={1} />
                <circle cx={px(hover)} cy={py(values[hover])} r={4} fill="var(--series-1)" stroke="var(--page)" strokeWidth={2} />
              </>
            )}
            {/* Hit area: the whole plot, not just the line. */}
            <rect width={width} height={HEIGHT} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(undefined)} />
          </svg>
        )}
      </div>
    </div>
  );
}
