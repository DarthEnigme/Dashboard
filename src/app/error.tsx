"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { useBranding } from "@/components/Branding";
import { Markdown } from "@/components/settings/Markdown";
import { useT } from "@/i18n/client";

/** Shown when a page fails to render. The layout (theme, language) is still there; only the page is replaced. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  const brand = useBranding();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div role="alert" className="glass w-full max-w-sm rounded-3xl p-7 text-center">
        {brand.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logo} alt="" className="mx-auto h-14 w-14 rounded-2xl object-contain" />
        ) : (
          <TriangleAlert className="mx-auto h-10 w-10 text-[var(--err)]" aria-hidden />
        )}
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{brand.errorHeading?.trim() || t("Something went wrong")}</h1>
        <div className="mt-2 flex flex-col gap-1 text-sm text-muted">
          {brand.errorMessage?.trim() ? <Markdown text={brand.errorMessage} /> : <p>{t("This page couldn't be shown. The server log has the details.")}</p>}
        </div>
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
