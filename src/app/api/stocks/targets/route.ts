import { NextResponse } from "next/server";
import { bad, body } from "@/lib/api";
import { loadTargets } from "@/lib/stocks/service";
import { setTargets } from "@/lib/stocks/targets";
import { guard, portfoliosOf } from "../_shared";

export const dynamic = "force-dynamic";

const reply = async (userId: number, portfolio: number | undefined) => NextResponse.json(await loadTargets(userId, await portfoliosOf(userId), portfolio));

/** ?portfolio= (else all together): what is held, the target weights, and a price for each target not held yet. */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  return reply(g.user.id, Number(new URL(req.url).searchParams.get("portfolio")) || undefined);
}

/** { portfolio (null: all together), targets: [{ symbol, weight }] }: replaces the targets; answers like GET. */
export async function PUT(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  try {
    setTargets(g.user.id, b);
  } catch (e) {
    return bad((e as Error).message);
  }
  return reply(g.user.id, Number(b.portfolio) || undefined);
}
