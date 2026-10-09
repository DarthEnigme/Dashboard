import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { summarize } from "@/lib/finance/aggregate";
import { ratesForSummary } from "@/lib/finance/rates";
import { allForSummary, currenciesInUse, listCategories } from "@/lib/finance/store";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * ?period=2026-10 (month) or ?period=2026 (year); defaults to the current month.
 * ?currency=USD shows everything in that currency (default: the finance currency setting);
 * other currencies are converted at the latest ECB rates.
 * ?account=Checking limits it to one account ("" = transactions without an account).
 */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = new URL(req.url).searchParams;
  const period = q.get("period") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}(-\d{2})?$/.test(period)) return bad("period must be YYYY or YYYY-MM");
  const defaultCurrency = loadConfig().settings.finance.currency.toUpperCase();
  const currency = (q.get("currency") || defaultCurrency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return bad("currency must be a three-letter code");
  const rates = await ratesForSummary(currency, [defaultCurrency]);
  // Budgets are set in the default currency.
  const budgetRate = currency === defaultCurrency ? 1 : rates?.rates[defaultCurrency];
  const categories = listCategories().map((c) => (c.budget && budgetRate ? { ...c, budget: Math.round(c.budget / budgetRate) } : c));
  return NextResponse.json({
    ...summarize(allForSummary(q.get("account") ?? undefined), categories, period, currency, rates?.rates),
    currencies: currenciesInUse(),
    ratesDate: rates?.date ?? null,
  });
}
