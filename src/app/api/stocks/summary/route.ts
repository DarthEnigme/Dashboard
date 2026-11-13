import { NextResponse } from "next/server";
import { portfolioSnapshot } from "@/lib/stocks/service";
import type { StocksSummary } from "@/lib/stocks/types";
import { guard, portfoliosOf } from "../_shared";

export const dynamic = "force-dynamic";

/** All your portfolios together, at a glance: value, today's change, and the best and worst holding today. */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  const d = await portfolioSnapshot(g.user.id, await portfoliosOf(g.user.id));
  const moving = d.positions.filter((p) => p.change !== null).sort((a, b) => b.change! - a.change!);
  const pick = (p: (typeof moving)[number] | undefined) => (p ? { symbol: p.symbol, change: p.change! } : null);
  const summary: StocksSummary = { currency: d.currency, value: d.value, dayChange: d.dayChange, dayChangePct: d.dayChangePct, holdings: d.positions.length, best: pick(moving[0]), worst: moving.length > 1 ? pick(moving[moving.length - 1]) : null };
  return NextResponse.json(summary);
}
