/**
 * Fonts for the font setting. All are bundled in public/fonts (OFL, latin subset) and declared in
 * globals.css; the browser only downloads the one in use. "system" keeps the platform font.
 */
export const fonts = {
  system: { label: "System (default)", family: null },
  inter: { label: "Inter", family: "Page Inter" },
  geist: { label: "Geist", family: "Page Geist" },
  "space-grotesk": { label: "Space Grotesk", family: "Page Space Grotesk" },
  nunito: { label: "Nunito (rounded)", family: "Page Nunito" },
  lora: { label: "Lora (serif)", family: "Page Lora" },
  "jetbrains-mono": { label: "JetBrains Mono", family: "Page JetBrains Mono" },
  atkinson: { label: "Atkinson Hyperlegible (easy to read)", family: "Page Atkinson" },
} as const satisfies Record<string, { label: string; family: string | null }>;

export type FontId = keyof typeof fonts;
export const fontIds = Object.keys(fonts) as [FontId, ...FontId[]];

/** The value for --font-choice, or undefined to keep the default stack. */
export function fontFamily(id: string | undefined): string | undefined {
  const f = fonts[id as FontId]?.family;
  return f ? `"${f}"` : undefined;
}
