import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { listRecurring, monthlyCents, nextOccurrence, today } from "@/lib/finance/recurring";
import { ratesFor } from "@/lib/finance/rates";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * Recurring payments tracked as subscriptions, each with its next renewal and monthly cost, and the
 * totals of the running ones in ?currency= (default: the finance currency), converted at ECB rates.
 */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const currency = (new URL(req.url).searchParams.get("currency") || loadConfig().settings.finance.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return bad("currency must be a three-letter code");
  const subs = listRecurring().filter((r) => r.subscription);
  const rates = subs.some((s) => s.currency.toUpperCase() !== currency) ? await ratesFor(currency) : undefined;
  const day = today();
  const items = subs.map((r) => {
    const next = nextOccurrence(r);
    const running = r.active && !!next && (!r.end_date || r.end_date >= day);
    const own = monthlyCents(r);
    const rate = r.currency.toUpperCase() === currency ? 1 : rates?.rates[r.currency.toUpperCase()];
    return { ...r, next, running, monthly: own, monthlyConverted: rate ? Math.round(own / rate) : null };
  });
  const counted = items.filter((i) => i.running && i.monthlyConverted !== null);
  const monthly = counted.reduce((a, i) => a + i.monthlyConverted!, 0);
  const byCategory = new Map<string, number>();
  for (const i of counted) byCategory.set(i.category ?? "", (byCategory.get(i.category ?? "") ?? 0) + i.monthlyConverted!);
  return NextResponse.json({
    currency,
    items,
    totals: {
      monthly,
      yearly: monthly * 12,
      running: items.filter((i) => i.running).length,
      // Running ones in a currency without a rate are left out of the totals.
      unconverted: items.filter((i) => i.running && i.monthlyConverted === null).length,
      byCategory: [...byCategory].map(([name, cents]) => ({ name, monthly: cents })).sort((a, b) => b.monthly - a.monthly),
    },
  });
}
