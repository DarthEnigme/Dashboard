import { crudRoutes } from "@/lib/api";
import { errorReason } from "@/lib/cache";
import { quoteCurrency } from "@/lib/stocks/service";
import { addTransaction, cleanSymbol, deleteTransaction, updateTransaction } from "@/lib/stocks/store";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** What the symbol is quoted in, which also proves Yahoo knows it. */
async function currencyOf(b: Record<string, unknown>) {
  const symbol = cleanSymbol(b.symbol);
  try {
    return await quoteCurrency(symbol);
  } catch (e) {
    throw new Error(`${symbol}: ${errorReason(e)}`);
  }
}

/** POST { portfolio, symbol, kind: buy | sell, date, quantity, price, fees?, note? }. PATCH { id, …the same }. DELETE ?id=. */
export const { POST, PATCH, DELETE } = crudRoutes(
  guard,
  {
    create: async (u, b) => addTransaction(u, b, await currencyOf(b)),
    update: async (u, b) => updateTransaction(u, b, await currencyOf(b)),
    remove: deleteTransaction,
  },
  () => ({ ok: true }),
);
