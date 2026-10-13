"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render a server-rendered page with fresh data every `seconds`, while its tab is visible. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
