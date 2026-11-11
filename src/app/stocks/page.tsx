import { appShell } from "@/lib/appPage";
import { SYMBOL } from "@/lib/stocks/types";
import { StocksPage } from "@/components/stocks/StocksPage";
import { isTab } from "@/components/stocks/tabIds";

export const dynamic = "force-dynamic";

/** ?add=<symbol> opens a new transaction for that symbol; ?tab= a section; ?alert=<symbol> a new alert for it. */
export default async function Stocks({ searchParams }: { searchParams: Promise<{ add?: string; tab?: string; alert?: string }> }) {
  const { background } = await appShell("stocks");
  const q = await searchParams;
  const add = q.add?.toUpperCase();
  const alert = q.alert?.toUpperCase();
  return (
    <>
      {background}
      <StocksPage add={add && SYMBOL.test(add) ? add : undefined} tab={isTab(q.tab) ? q.tab : undefined} alert={alert && SYMBOL.test(alert) ? alert : undefined} />
    </>
  );
}
