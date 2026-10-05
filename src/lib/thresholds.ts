import { z } from "zod";
import type { FieldStatus, WidgetField, WidgetResult } from "@/integrations/types";

/** `widget.thresholds`: per field label, alert when the value stays above/below a limit for `for` minutes. */
export const thresholdRuleSchema = z
  .object({
    above: z.number().optional(),
    below: z.number().optional(),
    /** Minutes the value must stay past the limit before alerting (default 0: at once). */
    for: z.number().min(0).default(0),
  })
  .refine((r) => r.above !== undefined || r.below !== undefined, "set above or below");
export type ThresholdRule = z.infer<typeof thresholdRuleSchema>;

/** Extra keys on any `widget:` block (integrations ignore them). */
export const widgetExtrasSchema = z.object({
  /** Store this widget's numbers over time (charts on the service page, threshold alerts). */
  record: z.boolean().optional(),
  thresholds: z.record(thresholdRuleSchema).optional(),
});
export type WidgetExtras = z.infer<typeof widgetExtrasSchema>;

export function widgetExtras(widget: unknown): WidgetExtras {
  const r = widgetExtrasSchema.safeParse(widget ?? {});
  return r.success ? r.data : {};
}

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };

/**
 * The number behind a field: `raw` when the integration gives it, else read from the text
 * ("49%" → 49, "1,234" → 1234, "5.0 GB" → 5e9, "12.5 °C" → 12.5). Ratios like "2 / 3" and
 * words are not numbers.
 */
export function numericValue(f: WidgetField): number | undefined {
  if (typeof f.raw === "number" && Number.isFinite(f.raw)) return f.raw;
  if (typeof f.value === "number") return Number.isFinite(f.value) ? f.value : undefined;
  const m = f.value.trim().match(/^([+-]?[\d,]*\.?\d+)\s*(%|[kmgt]i?b|b)?(?:\/s)?\s*(°[cf]|ms|s|w|v|a)?$/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2]?.toLowerCase();
  return unit && unit !== "%" ? n * (UNITS[unit] ?? 1) : n;
}

const past = (v: number, r: ThresholdRule) => (r.above !== undefined && v > r.above) || (r.below !== undefined && v < r.below);

/** Fields matching a rule (by label, case-insensitive) turn red while past their limit. */
export function applyThresholds(result: WidgetResult, rules: Record<string, ThresholdRule> | undefined): WidgetResult {
  if (!rules) return result;
  const byLabel = new Map(Object.entries(rules).map(([k, v]) => [k.toLowerCase(), v]));
  const mark = (f: WidgetField): WidgetField => {
    const rule = byLabel.get(f.label.toLowerCase());
    const v = rule ? numericValue(f) : undefined;
    return rule && v !== undefined && past(v, rule) ? { ...f, status: "error" as FieldStatus } : f;
  };
  return { ...result, fields: result.fields.map(mark), list: result.list?.map(mark) };
}

export interface BreachState {
  /** First reading past the limit in the current run. */
  since?: number;
  /** An alert went out and the value hasn't come back yet. */
  firing: boolean;
}

/**
 * One reading in, maybe one event out: "breach" once the value has been past the limit for
 * `rule.for` minutes, "clear" on the first reading back inside after a breach.
 */
export function evaluateThreshold(state: BreachState, value: number, rule: ThresholdRule, now: number): { state: BreachState; event?: "breach" | "clear" } {
  if (!past(value, rule)) {
    return state.firing ? { state: { firing: false }, event: "clear" } : { state: { firing: false } };
  }
  const since = state.since ?? now;
  if (!state.firing && now - since >= rule.for * 60_000) return { state: { since, firing: true }, event: "breach" };
  return { state: { since, firing: state.firing } };
}

export const describeRule = (r: ThresholdRule) =>
  [r.above !== undefined ? `above ${r.above}` : "", r.below !== undefined ? `below ${r.below}` : ""].filter(Boolean).join(" or ");
