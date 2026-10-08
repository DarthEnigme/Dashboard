import { loadConfig } from "../config/load";
import { hasAlertChannel, sendNotice } from "../alerts";
import { summarize, type BudgetStatus } from "./aggregate";
import { allForSummary, getMeta, listCategories, setMeta } from "./store";
import { money } from "./format";
import { ratesForSummary } from "./rates";

export const BUDGET_WARN_SHARE = 0.8;

/**
 * Budget thresholds crossed this month that have not been reported yet: "over" at 100%,
 * and "warn" at 80% when `level` is "warn". A category that jumps straight past 100% only
 * gets the "over" notice.
 */
export function budgetCrossings(budgets: BudgetStatus[], level: "over" | "warn", sent: (key: string) => boolean, month: string) {
  const out: { budget: BudgetStatus; mark: "over" | "warn"; key: string }[] = [];
  for (const b of budgets) {
    const r = b.spent / b.budget;
    const mark = r >= 1 ? "over" : level === "warn" && r >= BUDGET_WARN_SHARE ? "warn" : undefined;
    if (!mark) continue;
    const key = `budget-alert:${month}:${b.name.toLowerCase()}:${mark}`;
    if (!sent(key)) out.push({ budget: b, mark, key });
  }
  return out;
}

/** Hourly: tell the alert channels about budgets used up this month (once per category and threshold). */
export async function budgetAlertJob() {
  const { settings } = loadConfig();
  const level = settings.finance.budgetAlerts;
  if (level === "off" || !hasAlertChannel(settings.alerts)) return;
  const month = new Date().toISOString().slice(0, 7);
  const currency = settings.finance.currency;
  const s = summarize(allForSummary(), listCategories(), month, currency, (await ratesForSummary(currency))?.rates);
  for (const { budget: b, mark, key } of budgetCrossings(s.budgets, level, (k) => !!getMeta(k), month)) {
    const pct = Math.round((b.spent / b.budget) * 100);
    const errors = await sendNotice(settings.alerts, {
      kind: "budget",
      level: mark === "over" ? "error" : "warn",
      message:
        mark === "over"
          ? `Budget for ${b.name} is used up: ${money(b.spent, currency)} of ${money(b.budget, currency)} (${pct}%) in ${s.period.label}.`
          : `Budget for ${b.name} is at ${pct}%: ${money(b.spent, currency)} of ${money(b.budget, currency)} in ${s.period.label}.`,
      category: b.name,
      spentCents: b.spent,
      budgetCents: b.budget,
    });
    if (!errors.length) setMeta(key, new Date().toISOString());
    else console.warn(`[page] budget alert for ${b.name} failed: ${errors.join("; ")}`);
  }
}
