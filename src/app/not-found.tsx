import Link from "next/link";
import { Compass } from "lucide-react";
import { loadConfig } from "@/lib/config/load";
import { Background } from "@/components/Background";
import { Markdown } from "@/components/settings/Markdown";
import { getT } from "@/i18n/server";

/** Shown for URLs that lead nowhere (and for tabs or services that no longer exist). */
export default async function NotFound() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth, ...settings } = loadConfig().settings;
  const t = await getT();
  const { errorPages } = settings;
  return (
    <>
      <Background settings={settings} />
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <div className="glass w-full max-w-sm rounded-3xl p-7 text-center">
          {errorPages.logo && settings.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.logo} alt="" className="mx-auto h-14 w-14 rounded-2xl object-contain" />
          ) : (
            <Compass className="mx-auto h-10 w-10 text-muted" aria-hidden />
          )}
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{errorPages.notFoundHeading?.trim() || t("Nothing here")}</h1>
          <div className="mt-2 flex flex-col gap-1 text-sm text-muted">
            {errorPages.notFoundMessage?.trim() ? <Markdown text={errorPages.notFoundMessage} /> : <p>{t("This address doesn't lead anywhere. It may have been renamed or removed.")}</p>}
          </div>
          <Link href="/" className="mt-6 flex h-10 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110">
            {t("Back to dashboard")}
          </Link>
        </div>
      </main>
    </>
  );
}
