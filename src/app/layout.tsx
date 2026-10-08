import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { loadConfig } from "@/lib/config/load";
import { serverAccent, themeAttrs } from "@/lib/theme";
import { buildInfo } from "@/lib/version";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  const { settings } = loadConfig();
  const look = themeAttrs(settings.theme);
  return (
    <html
      lang="en"
      data-theme={look.theme}
      data-tone={look.tone}
      data-style={settings.style}
      data-glow={settings.glow}
      data-build={buildInfo().buildId}
      data-version={buildInfo().version}
      style={{ "--accent": serverAccent(settings.accent, settings.background.gradient) } as CSSProperties}
    >
      <body>
        <PointerLight />
        {children}
        <PaletteLauncher />
        <PwaRegister />
      </body>
    </html>
  );
}
