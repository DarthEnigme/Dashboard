import { appShell } from "@/lib/appPage";
import { SYMBOL } from "@/lib/stocks/types";
import { StocksPage } from "@/components/stocks/StocksPage";

export const dynamic = "force-dynamic";

/** ?add=<symbol> opens a new transaction for that symbol. */
export default async function Stocks({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const { background } = await appShell("stocks");
  const add = (await searchParams).add?.toUpperCase();
  return (
    <>
      {background}
      <StocksPage add={add && SYMBOL.test(add) ? add : undefined} />
    </>
  );
}
