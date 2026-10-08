import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { convertTxns } from "@/lib/finance/aggregate";
import { project } from "@/lib/finance/projection";
import { ratesForSummary } from "@/lib/finance/rates";
import { listRecurring, today } from "@/lib/finance/recurring";
import { allForSummary } from "@/lib/finance/store";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

/** Expected balance for this month and the next 11, in ?currency= (default: the finance currency). */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const currency = (new URL(req.url).searchParams.get("currency") || loadConfig().settings.finance.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return bad("currency must be a three-letter code");
  const rules = listRecurring();
  const rates = (await ratesForSummary(currency, rules.map((r) => r.currency)))?.rates ?? {};
  const { txns } = convertTxns(allForSummary(), currency, rates);
  // Rules in a currency without a rate are left out, like their transactions.
  const converted = rules.flatMap((r) => {
    const rate = r.currency === currency ? 1 : rates[r.currency];
    return rate ? [{ ...r, amount_cents: Math.round(r.amount_cents / rate) }] : [];
  });
  return NextResponse.json({ currency, ...project(txns, converted, today()) });
}
