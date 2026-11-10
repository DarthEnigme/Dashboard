import { guardFor } from "@/lib/api";
import { loadConfig } from "@/lib/config/load";
import { getT } from "@/i18n/server";
import { ensurePortfolios } from "@/lib/stocks/store";

export const guard = guardFor("stocks", "the stock portfolio");

/** This person's portfolios; a first one is made in the finance currency, named in their language. */
export const portfoliosOf = async (userId: number) => ensurePortfolios(userId, (await getT())("Main portfolio"), loadConfig().settings.finance.currency);
