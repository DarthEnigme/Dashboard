import { attempt, bad, body } from "@/lib/api";
import { errorReason } from "@/lib/cache";
import { quoteCurrency } from "@/lib/stocks/service";
import { addTransaction, cleanSymbol, deleteTransaction, updateTransaction } from "@/lib/stocks/store";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** Save a buy or a sell once Yahoo confirms the symbol and says what it is quoted in. */
async function save(req: Request, store: typeof addTransaction, status: number) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  let currency: string;
  try {
    currency = await quoteCurrency(cleanSymbol(b.symbol));
  } catch (e) {
    return bad(`${String(b.symbol ?? "")}: ${errorReason(e)}`);
  }
  return attempt(() => {
    store(g.user.id, b, currency);
    return { ok: true };
  }, status);
}

/** { portfolio, symbol, kind: buy | sell, date, quantity, price, fees?, note? } */
export const POST = (req: Request) => save(req, addTransaction, 201);

/** { id, …the same fields } */
export const PATCH = (req: Request) => save(req, updateTransaction, 200);

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  return attempt(() => {
    deleteTransaction(g.user.id, id);
    return { ok: true };
  });
}
