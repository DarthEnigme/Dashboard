import type { Metadata, Viewport } from "next";
import type { CSSProperties, ReactNode } from "react";
import { loadConfig } from "@/lib/config/load";
import { serverAccent } from "@/lib/theme";
import { buildInfo } from "@/lib/version";
import { PwaRegister } from "@/components/PwaRegister";
import { PointerLight } from "@/components/PointerLight";
import { PaletteLauncher } from "@/components/palette/PaletteLauncher";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = loadConfig();
  return {
    title: settings.title,
    description: settings.description,
    appleWebApp: { capable: true, title: settings.title, statusBarStyle: "black-translucent" },
    icons: { icon: "/pwa-icon/192", apple: "/pwa-icon/180" },
  };
}

export const viewport: Viewport = { themeColor: "#0b0b14", viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  const { settings } = loadConfig();
  return (
    <html
      lang="en"
      data-theme={settings.theme}
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
