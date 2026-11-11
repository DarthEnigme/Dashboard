import { crudRoutes } from "@/lib/api";
import { addPortfolio, deletePortfolio, listPortfolios, updatePortfolio } from "@/lib/stocks/store";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** POST { name, currency }. PATCH { id, name, currency }. DELETE ?id=: the portfolio goes with its transactions (the last one stays). Each answers with every portfolio. */
export const { POST, PATCH, DELETE } = crudRoutes(guard, { create: addPortfolio, update: updatePortfolio, remove: deletePortfolio }, (userId) => listPortfolios(userId));
