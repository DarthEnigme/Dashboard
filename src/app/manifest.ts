import type { MetadataRoute } from "next";
import { loadConfig } from "@/lib/config/load";
import { gradientColors } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const { settings } = loadConfig();
  const bg = gradientColors[settings.background.gradient]?.base ?? "#0b0b14";
  return {
    name: settings.title,
    short_name: settings.title,
    description: settings.description,
    start_url: "/",
    display: "standalone",
    background_color: bg,
    theme_color: bg,
    icons: [192, 512].flatMap((size) => [
      { src: `/pwa-icon/${size}`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" as const },
      { src: `/pwa-icon/${size}?maskable=1`, sizes: `${size}x${size}`, type: "image/png", purpose: "maskable" as const },
    ]),
  };
}
