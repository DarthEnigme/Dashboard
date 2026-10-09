import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { loadConfig } from "@/lib/config/load";
import { glowAmount, glowAttr, paletteCss, resolveTheme, serverAccent } from "@/lib/theme";
import { buildInfo } from "@/lib/version";
import { getLocale } from "@/i18n/server";
import { I18nProvider } from "@/i18n/client";
import { iconVersion } from "@/lib/logo";
import { PwaRegister } from "@/components/PwaRegister";
import { PointerLight } from "@/components/PointerLight";
import { PaletteLauncher } from "@/components/palette/PaletteLauncher";
import "./globals.css";
import "./looks.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = loadConfig();
  return {
    title: settings.title,
    description: settings.description,
    appleWebApp: { capable: true, title: settings.title, statusBarStyle: "black-translucent" },
    icons: { icon: `/pwa-icon/192?v=${iconVersion(settings)}`, apple: `/pwa-icon/180?v=${iconVersion(settings)}` },
  };
}

export const viewport: Viewport = { themeColor: "#0b0b14", viewportFit: "cover" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { settings } = loadConfig();
  const locale = await getLocale();
  const look = resolveTheme(settings.theme, settings.customThemes);
  return (
    <html
      lang={locale}
      data-theme={look.theme}
      data-tone={look.tone}
      data-palette={look.palette ? "" : undefined}
      data-style={settings.style}
      data-glow={glowAttr(settings.glow)}
      data-build={buildInfo().buildId}
      data-version={buildInfo().version}
      style={{ "--accent": serverAccent(settings.accent, settings.background.gradient, settings.customThemes), "--glow": glowAmount(settings.glow) / 100 } as CSSProperties}
    >
      <body>
        {/* Colour theme (Nord, a custom one…); the settings preview rewrites it in place. */}
        <style id="page-palette">{paletteCss(look.palette)}</style>
        <I18nProvider locale={locale}>
          <PointerLight />
          {children}
          <PaletteLauncher />
          <PwaRegister />
        </I18nProvider>
      </body>
    </html>
  );
}
