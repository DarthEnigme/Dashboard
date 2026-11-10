import { NextResponse } from "next/server";
import { loadStocks } from "@/lib/stocks/service";
import { guard, portfoliosOf } from "./_shared";

export const dynamic = "force-dynamic";

/** Your portfolio (?portfolio=<id>, else all of them together): positions, value over time against ?benchmark=, dividends and transactions. */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await loadStocks(g.user.id, await portfoliosOf(g.user.id), Number(q.get("portfolio")) || undefined, q.get("benchmark") ?? undefined));
}
