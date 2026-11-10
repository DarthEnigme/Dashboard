import { notFound } from "next/navigation";
import { appShell } from "@/lib/appPage";
import { SYMBOL } from "@/lib/stocks/types";
import { StockPage } from "@/components/stocks/StockPage";

export const dynamic = "force-dynamic";

/** The research page of one symbol (AAPL, MC.PA, ^GSPC…). */
export default async function Stock({ params }: { params: Promise<{ symbol: string }> }) {
  const { background } = await appShell("stocks");
  const symbol = decodeURIComponent((await params).symbol).toUpperCase();
  if (!SYMBOL.test(symbol)) notFound();
  return (
    <>
      {background}
      <StockPage symbol={symbol} />
    </>
  );
}
