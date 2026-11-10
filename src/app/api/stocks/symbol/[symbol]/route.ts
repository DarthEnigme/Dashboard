import { NextResponse } from "next/server";
import { bad } from "@/lib/api";
import { errorReason } from "@/lib/cache";
import { oneOf } from "@/lib/clean";
import { loadResearch } from "@/lib/stocks/service";
import { RANGES, SYMBOL } from "@/lib/stocks/types";
import { guard } from "../../_shared";

export const dynamic = "force-dynamic";

/** One symbol: price history over ?range= (1m, 6m, ytd, 1y, 5y, max), company figures, dividends, and what you hold of it. */
export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const g = await guard();
  if ("error" in g) return g.error;
  const symbol = decodeURIComponent((await params).symbol).toUpperCase();
  if (!SYMBOL.test(symbol)) return bad("No such symbol", 404);
  try {
    return NextResponse.json(await loadResearch(g.user.id, symbol, oneOf(new URL(req.url).searchParams.get("range"), RANGES, "1y")));
  } catch (e) {
    return bad(`${symbol}: ${errorReason(e)}`, 502);
  }
}
