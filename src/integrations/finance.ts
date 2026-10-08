import { z } from "zod";
import { loadConfig } from "@/lib/config/load";
import { summarize, type Summary } from "@/lib/finance/aggregate";
import { allForSummary, listCategories } from "@/lib/finance/store";
import { ratesForSummary } from "@/lib/finance/rates";
import { money } from "@/lib/finance/format";
import type { Integration, WidgetResult } from "./types";

const schema = z.object({
  /** This month or this year. */
  period: z.enum(["month", "year"]).default("month"),
  /** Main chart on wide and large tiles. */
  chart: z.enum(["donut", "sankey"]).default("donut"),
});

export function financeResult(s: Summary, main: "donut" | "sankey" = "donut"): WidgetResult {
  return {
    fields: [
      { label: "Spent", value: money(s.expense, s.currency) },
      { label: "Income", value: money(s.income, s.currency) },
      { label: s.period.label, value: money(s.net, s.currency, true), status: s.net < 0 ? "error" : "ok" },
    ],
    charts: { currency: s.currency, donut: s.categories, bars: s.months, balance: s.balance, flow: s.flow, main },
  };
}

/** Reads Page's own finance tracker (no external service). */
export const finance: Integration<typeof schema> = {
  type: "finance",
  schema,
  async fetch(cfg) {
    const now = new Date().toISOString();
    const period = cfg.period === "year" ? now.slice(0, 4) : now.slice(0, 7);
    const currency = loadConfig().settings.finance.currency;
    return financeResult(summarize(allForSummary(), listCategories(), period, currency, (await ratesForSummary(currency))?.rates), cfg.chart);
  },
};
