import Link from "next/link";
import { Compass } from "lucide-react";
import { loadConfig } from "@/lib/config/load";
import { Background } from "@/components/Background";
import { getT } from "@/i18n/server";

/** Shown for URLs that lead nowhere (and for tabs or services that no longer exist). */
export default async function NotFound() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth, ...settings } = loadConfig().settings;
  const t = await getT();
  return (
    <>
      <Background settings={settings} />
      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <div className="glass w-full max-w-sm rounded-3xl p-7 text-center">
          <Compass className="mx-auto h-10 w-10 text-muted" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{t("Nothing here")}</h1>
          <p className="mt-2 text-sm text-muted">{t("This address doesn't lead anywhere. It may have been renamed or removed.")}</p>
          <Link href="/" className="mt-6 flex h-10 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110">
            {t("Back to dashboard")}
          </Link>
        </div>
      </main>
    </>
  );
}
