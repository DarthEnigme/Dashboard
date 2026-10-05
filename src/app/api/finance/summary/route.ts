import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { summarize } from "@/lib/finance/aggregate";
import { allForSummary, listCategories } from "@/lib/finance/store";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

/** ?period=2026-10 (month) or ?period=2026 (year); defaults to the current month. */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const period = new URL(req.url).searchParams.get("period") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}(-\d{2})?$/.test(period)) return bad("period must be YYYY or YYYY-MM");
  return NextResponse.json(summarize(allForSummary(), listCategories(), period, loadConfig().settings.finance.currency));
}
