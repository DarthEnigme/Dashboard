import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField } from "./types";

const schema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  /** Which currency's summary to show when you have several (default: the first). */
  currency: z.string().optional(),
  insecure: z.boolean().optional(),
});

export type FireflySummary = Record<string, { monetary_value: number; currency_code: string; value_parsed: string }>;

export function parseFirefly(s: FireflySummary, currency?: string): WidgetField[] {
  const code = currency?.toUpperCase() ?? Object.values(s)[0]?.currency_code;
  const get = (kind: string) => s[`${kind}-in-${code}`];
  const show = (label: string, kind: string, colour?: boolean): WidgetField[] => {
    const e = get(kind);
    if (!e) return [];
    return [{ label, value: e.value_parsed, status: colour && e.monetary_value < 0 ? "error" : undefined }];
  };
  return [
    ...show("Balance", "balance", true),
    ...show("Spent", "spent"),
    ...show("Earned", "earned"),
    ...show("Net worth", "net-worth", true),
    ...show("Left to spend", "left-to-spend", true),
  ];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Firefly III: this month's summary via a personal access token. */
export const firefly: Integration<typeof schema> = {
  type: "firefly",
  schema,
  async fetch(cfg) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
    const q = new URLSearchParams({ start: ymd(start), end: ymd(end) });
    const summary = await httpJson<FireflySummary>(`${trimSlash(cfg.url)}/api/v1/summary/basic?${q}`, {
      insecure: cfg.insecure,
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    return parseFirefly(summary, cfg.currency);
  },
};
