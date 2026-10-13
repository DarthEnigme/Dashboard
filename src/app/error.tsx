"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { useT } from "@/i18n/client";

/** Shown when a page fails to render. The layout (theme, language) is still there; only the page is replaced. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div role="alert" className="glass w-full max-w-sm rounded-3xl p-7 text-center">
        <TriangleAlert className="mx-auto h-10 w-10 text-[var(--err)]" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{t("Something went wrong")}</h1>
        <p className="mt-2 text-sm text-muted">{t("This page couldn't be shown. The server log has the details.")}</p>
        {error.digest && <p className="mt-2 font-mono text-xs text-muted">{error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-6 flex h-10 w-full items-center justify-center rounded-xl bg-accent text-sm font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110"
        >
          {t("Try again")}
        </button>
        {/* A full load, not a client-side one: whatever broke may be in what the browser already holds. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className="mt-3 block text-sm text-muted hover:text-fg">
          {t("Back to dashboard")}
        </a>
      </div>
    </main>
  );
}
