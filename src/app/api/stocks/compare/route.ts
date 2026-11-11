import { NextResponse } from "next/server";
import { bad } from "@/lib/api";
import { oneOf } from "@/lib/clean";
import { loadCompare } from "@/lib/stocks/compare";
import { cleanSymbol } from "@/lib/stocks/store";
import { RANGES } from "@/lib/stocks/types";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** ?symbols=A,B (up to 12), ?range=, ?benchmark=, ?portfolio=1 to cross your portfolio with the market. */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = new URL(req.url).searchParams;
  let symbols: string[];
  try {
    symbols = [...new Set((q.get("symbols") ?? "").split(",").filter(Boolean).map(cleanSymbol))].slice(0, 12);
  } catch (e) {
    return bad((e as Error).message);
  }
  return NextResponse.json(await loadCompare(g.user.id, symbols, oneOf(q.get("range"), RANGES, "1y"), q.get("benchmark") ?? undefined, q.get("portfolio") === "1"));
}
