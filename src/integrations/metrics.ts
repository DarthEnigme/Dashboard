import { z } from "zod";
import type { FieldStatus, WidgetField } from "./types";
import { bytes, duration } from "./format";

// Shared by the monitoring integrations (Prometheus, generic metric): number formats and thresholds.

export const metricFormats = ["number", "percent", "ratio", "bytes", "bytesPerSec", "duration", "text"] as const;
export type MetricFormat = (typeof metricFormats)[number];

export const thresholdSchema = {
  /** At or above this value the field turns amber (below it with lowerIsWorse). */
  warn: z.number().optional(),
  /** At or above this value the field turns red (below it with lowerIsWorse). */
  error: z.number().optional(),
  lowerIsWorse: z.boolean().optional(),
};

export interface Thresholds {
  warn?: number;
  error?: number;
  lowerIsWorse?: boolean;
}

export function thresholdStatus(v: number, t: Thresholds): FieldStatus | undefined {
  if (t.warn === undefined && t.error === undefined) return undefined;
  const past = (limit?: number) => limit !== undefined && (t.lowerIsWorse ? v <= limit : v >= limit);
  return past(t.error) ? "error" : past(t.warn) ? "warn" : "ok";
}

/** Format a metric value. "percent" is already 0–100; "ratio" is 0–1. */
export function formatMetric(v: number | string | undefined, format: MetricFormat = "number", decimals?: number): string {
  if (v === undefined || v === "") return "–";
  const n = typeof v === "number" ? v : Number(v);
  if (format === "text" || !Number.isFinite(n)) return String(v);
  const fixed = (x: number) => (decimals !== undefined ? x.toFixed(decimals) : x.toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) < 10 ? 2 : Math.abs(x) < 100 ? 1 : 0 }));
  switch (format) {
    case "percent":
      return `${decimals !== undefined ? n.toFixed(decimals) : n.toFixed(n < 10 ? 1 : 0)}%`;
    case "ratio":
      return `${decimals !== undefined ? (n * 100).toFixed(decimals) : (n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
    case "bytes":
      return bytes(n);
    case "bytesPerSec":
      return `${bytes(n)}/s`;
    case "duration":
      return duration(n);
    default:
      return fixed(n);
  }
}

/** Unit for sparkline hover values and the y-scale cap for percentages. */
export function sparkScale(format: MetricFormat): { unit?: string; max?: number; scale: number } {
  if (format === "percent") return { unit: "%", max: 100, scale: 1 };
  if (format === "ratio") return { unit: "%", max: 100, scale: 100 };
  return { scale: 1 };
}

export function metricField(label: string, v: number | string | undefined, opts: Thresholds & { format?: MetricFormat; decimals?: number; suffix?: string } = {}): WidgetField {
  const text = formatMetric(v, opts.format, opts.decimals);
  const n = typeof v === "number" ? v : Number(v);
  return {
    label,
    raw: Number.isFinite(n) && v !== undefined && v !== "" ? n : undefined,
    value: opts.suffix && text !== "–" ? `${text}${opts.suffix}` : text,
    status: Number.isFinite(n) && v !== undefined && v !== "" ? thresholdStatus(n, opts) : undefined,
  };
}
