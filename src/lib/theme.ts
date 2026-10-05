export const gradientColors: Record<string, { base: string; blobs: [string, string, string]; swatch?: string }> = {
  aurora: { base: "#090a18", blobs: ["#7c3aed", "#06b6d4", "#10b981"] },
  sunset: { base: "#160912", blobs: ["#f97316", "#ec4899", "#8b5cf6"] },
  ocean: { base: "#04111d", blobs: ["#0ea5e9", "#2563eb", "#14b8a6"] },
  midnight: { base: "#05060b", blobs: ["#4f46e5", "#1e3a8a", "#9333ea"] },
  forest: { base: "#06120b", blobs: ["#16a34a", "#65a30d", "#0d9488"] },
  // Frutiger Aero: sky, water and grass. Drawn by Background.tsx with its own layers, not blobs.
  aero: {
    base: "#0a3a63",
    blobs: ["#1ea7e1", "#7ac943", "#5fd4ff"],
    swatch:
      "radial-gradient(90% 50% at 50% 115%, #7ac943 0, transparent 70%), radial-gradient(circle at 75% 30%, #ffffffcc 0 6%, transparent 7%), radial-gradient(circle at 30% 55%, #ffffff99 0 4%, transparent 5%), linear-gradient(#2a8fd8, #8fd6ff 70%, #c9f1ff)",
  },
};

/** One-click looks in the settings: a card style, a background and an accent that belong together. */
export const lookPresets = [
  { id: "aero", label: "Frutiger Aero", style: "aero", gradient: "aero", accent: "#1ea7e1", glow: "subtle" },
  { id: "liquid", label: "Liquid Glass", style: "liquid", gradient: "aurora", accent: "#8b5cf6", glow: "subtle" },
  { id: "classic", label: "Classic", style: "glass", gradient: "aurora", accent: "#8b5cf6", glow: "subtle" },
] as const;

export const DEFAULT_ACCENT = "#8b5cf6";

/** The accent to render on the server; "auto" with a wallpaper image is refined in the browser. */
export function serverAccent(accent: string, gradient: string): string {
  if (accent !== "auto") return accent;
  return gradientColors[gradient]?.blobs[0] ?? DEFAULT_ACCENT;
}

/**
 * Pick a vivid representative colour from RGBA pixel data: hue-average of saturated,
 * mid-lightness pixels, weighted by saturation. Returns null for greyscale images.
 */
export function accentFromPixels(data: Uint8ClampedArray | number[]): string | null {
  let x = 0;
  let y = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d || l < 0.15 || l > 0.85) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    if (s < 0.3) continue;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const rad = (h * Math.PI) / 180;
    x += Math.cos(rad) * s;
    y += Math.sin(rad) * s;
    weight += s;
  }
  if (weight < 1) return null;
  const hue = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
  return `hsl(${hue} 75% 62%)`;
}
