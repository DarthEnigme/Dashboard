import { NextResponse } from "next/server";
import { crudRoutes } from "@/lib/api";
import { addPortfolio, deletePortfolio, heldSymbols, updatePortfolio } from "@/lib/stocks/store";
import type { PortfolioList } from "@/lib/stocks/types";
import { guard, portfoliosOf } from "../_shared";

export const dynamic = "force-dynamic";

const list = async (userId: number): Promise<PortfolioList> => ({ portfolios: await portfoliosOf(userId), held: heldSymbols(userId) });

/** Your portfolios and the symbols you hold in them: what the page needs without asking Yahoo for any price. */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(await list(g.user.id));
}

/** POST { name, currency }. PATCH { id, name, currency }. DELETE ?id=: the portfolio goes with its transactions (the last one stays). Each answers like GET. */
export const { POST, PATCH, DELETE } = crudRoutes(guard, { create: addPortfolio, update: updatePortfolio, remove: deletePortfolio }, list);
