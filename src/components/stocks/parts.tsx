"use client";

import type { ReactNode } from "react";

/** A headline figure with its label, and a smaller line under it. */
export function Stat({ label, value, note, tone = "" }: { label: string; value: string; note?: ReactNode; tone?: string }) {
  return (
    <div className="glass rounded-3xl p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold tracking-tight tabular-nums ${tone}`}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-muted tabular-nums">{note}</div>}
    </div>
  );
}

/** A titled card, with room for a control on the right of the title. */
export function Card({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`glass flex flex-col gap-3 rounded-3xl p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A row of choices where one is on (ranges, annual or quarterly…). */
export function Choice<T extends string>({ options, value, onChange, label }: { options: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1 text-sm" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)} className="rounded-full px-3 py-1 text-muted hover:bg-hover hover:text-fg aria-pressed:bg-chip aria-pressed:text-fg">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small trend line scaled to its own range, green when it ends higher than it began. */
export function Spark({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="inline-block" style={{ width, height }} />;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <polyline points={points} fill="none" stroke={values[values.length - 1] >= values[0] ? "var(--ok)" : "var(--err)"} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
