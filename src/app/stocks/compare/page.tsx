import { Suspense } from "react";
import { appShell } from "@/lib/appPage";
import { ComparePage } from "@/components/stocks/compare/ComparePage";

export const dynamic = "force-dynamic";

/** Symbols side by side, on any figures; the choices live in the address so a comparison can be shared or bookmarked. */
export default async function Compare() {
  const { background } = await appShell("stocks");
  return (
    <>
      {background}
      <Suspense>
        <ComparePage />
      </Suspense>
    </>
  );
}
