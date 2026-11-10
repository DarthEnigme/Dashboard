import { attempt, body } from "@/lib/api";
import { addPortfolio, deletePortfolio, listPortfolios, updatePortfolio } from "@/lib/stocks/store";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** { name, currency }; answers with every portfolio. */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return attempt(() => {
    addPortfolio(g.user.id, b);
    return listPortfolios(g.user.id);
  }, 201);
}

/** { id, name, currency } */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return attempt(() => {
    updatePortfolio(g.user.id, b);
    return listPortfolios(g.user.id);
  });
}

/** ?id=: the portfolio goes with its transactions (the last one stays). */
export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  return attempt(() => {
    deletePortfolio(g.user.id, id);
    return listPortfolios(g.user.id);
  });
}
