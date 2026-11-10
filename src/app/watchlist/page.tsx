import { appShell } from "@/lib/appPage";
import { WatchlistPage } from "@/components/watchlist/WatchlistPage";

export const dynamic = "force-dynamic";

export default async function Watchlist() {
  const { background } = await appShell("watchlist");
  return (
    <>
      {background}
      <WatchlistPage />
    </>
  );
}
