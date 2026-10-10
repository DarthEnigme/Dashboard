export const gradientColors: Record<string, { base: string; blobs: [string, string, string]; swatch?: string }> = {
  aurora: { base: "#090a18", blobs: ["#7c3aed", "#06b6d4", "#10b981"] },
  sunset: { base: "#160912", blobs: ["#f97316", "#ec4899", "#8b5cf6"] },
  ocean: { base: "#04111d", blobs: ["#0ea5e9", "#2563eb", "#14b8a6"] },
  midnight: { base: "#05060b", blobs: ["#4f46e5", "#1e3a8a", "#9333ea"] },
  forest: { base: "#06120b", blobs: ["#16a34a", "#65a30d", "#0d9488"] },
  dawn: { base: "#1a1020", blobs: ["#fb7185", "#fdba74", "#c4b5fd"] },
  lagoon: { base: "#03161a", blobs: ["#2dd4bf", "#f472b6", "#22d3ee"] },
  graphite: { base: "#0d0d10", blobs: ["#52525b", "#3f3f46", "#71717a"] },
  ember: { base: "#140806", blobs: ["#ea580c", "#b91c1c", "#f59e0b"] },
  arctic: { base: "#0b1622", blobs: ["#88c0d0", "#5e81ac", "#a5f3fc"] },
  rose: { base: "#1a0a12", blobs: ["#f43f5e", "#fda4af", "#be185d"] },
  mint: { base: "#06140f", blobs: ["#34d399", "#a7f3d0", "#0ea5e9"] },
  dusk: { base: "#120c1f", blobs: ["#bd93f9", "#ff79c6", "#6272a4"] },
  cyberpunk: { base: "#0a0614", blobs: ["#7aa2f7", "#f7768e", "#bb9af7"] },
  sand: { base: "#1a140b", blobs: ["#d6b37a", "#b45309", "#fde68a"] },
  "deep-sea": { base: "#020b14", blobs: ["#0e7490", "#1e40af", "#268bd2"] },
  // Discord's Nitro gradient themes.
  "mint-apple": { base: "#0b1a14", blobs: ["#56b69f", "#63bc61", "#9eca67"] },
  "citrus-sherbert": { base: "#1c120a", blobs: ["#f3b336", "#ee8558", "#f6c96a"] },
  "retro-raincloud": { base: "#0d141c", blobs: ["#3a7ca1", "#7f7eb9", "#5b6f9e"] },
  hanami: { base: "#1c1214", blobs: ["#efaab3", "#efd696", "#a6daa2"] },
  sunrise: { base: "#1a0d14", blobs: ["#9f4175", "#c49064", "#a6953d"] },
  "cotton-candy": { base: "#1a0f1b", blobs: ["#f4abb8", "#b1c2fc", "#e8a7d8"] },
  "lofi-vibes": { base: "#11141c", blobs: ["#a4c0f7", "#a9e4e8", "#b0e2b8"] },
  "desert-khaki": { base: "#18140d", blobs: ["#e7dbd0", "#dfd0b2", "#e0d6a3"] },
  "chroma-glow": { base: "#06121a", blobs: ["#0e9ab4", "#a12bd5", "#e3238c"] },
  "crimson-moon": { base: "#120406", blobs: ["#950909", "#3a0c0c", "#c41c1c"] },
  "midnight-blurple": { base: "#0b0a1f", blobs: ["#5348ca", "#140730", "#7b6fe0"] },
  "under-the-sea": { base: "#081410", blobs: ["#647962", "#588575", "#6a6981"] },
  "neon-nights": { base: "#061018", blobs: ["#01a89e", "#7d60ba", "#b43898"] },
  "strawberry-lemonade": { base: "#1a0710", blobs: ["#af1a6c", "#c26b20", "#e7c33a"] },
  // Drawn by Background.tsx with their own layers (blobs are only used for "auto" accents).
  nebula: {
    base: "#05030f",
    blobs: ["#a78bfa", "#3b82f6", "#ec4899"],
    swatch:
      "radial-gradient(circle at 20% 30%, #fff 0 1px, transparent 2px), radial-gradient(circle at 70% 65%, #fff 0 1px, transparent 2px), radial-gradient(circle at 45% 20%, #fff 0 1px, transparent 2px), radial-gradient(60% 50% at 30% 40%, #7c3aed99, transparent 70%), radial-gradient(50% 50% at 75% 70%, #db277799, transparent 70%), #05030f",
  },
  synthwave: {
    base: "#1a0533",
    blobs: ["#ff3ea5", "#7c3aed", "#22d3ee"],
    swatch:
      "radial-gradient(circle at 50% 62%, #ffd23f 0 18%, #ff3ea5 30%, transparent 31%), linear-gradient(transparent 62%, #2b0b4f 62%), repeating-linear-gradient(90deg, transparent 0 9px, #ff3ea566 9px 10px), linear-gradient(#1a0533, #6b1d7a 60%)",
  },
  // Frutiger Aero: sky, water and grass. Drawn by Background.tsx with its own layers, not blobs.
  aero: {
    base: "#0a3a63",
    blobs: ["#1ea7e1", "#7ac943", "#5fd4ff"],
    swatch:
      "radial-gradient(90% 50% at 50% 115%, #7ac943 0, transparent 70%), radial-gradient(circle at 75% 30%, #ffffffcc 0 6%, transparent 7%), radial-gradient(circle at 30% 55%, #ffffff99 0 4%, transparent 5%), linear-gradient(#2a8fd8, #8fd6ff 70%, #c9f1ff)",
  },
};

export interface LookPreset {
  id: string;
  label: string;
  style: string;
  gradient: string;
  accent: string;
  glow: string | number;
  /** Some looks only work in one theme (Paper is sepia, Brutalist is light). */
  theme?: string;
}

/** One-click looks in the settings: a card style, a background and an accent that belong together. */
export const lookPresets: LookPreset[] = [
  { id: "aero", label: "Frutiger Aero", style: "aero", gradient: "aero", accent: "#1ea7e1", glow: "subtle" },
  { id: "liquid", label: "Liquid Glass", style: "liquid", gradient: "aurora", accent: "#8b5cf6", glow: "subtle" },
  { id: "synthwave", label: "Synthwave", style: "neon", gradient: "synthwave", accent: "#ff3ea5", glow: "strong", theme: "dark" },
  { id: "nebula", label: "Nebula", style: "liquid", gradient: "nebula", accent: "#a78bfa", glow: "subtle", theme: "oled" },
  { id: "brutalist", label: "Brutalist", style: "brutal", gradient: "graphite", accent: "#facc15", glow: "none", theme: "light" },
  { id: "paper", label: "Paper", style: "soft", gradient: "dawn", accent: "#c2410c", glow: "subtle", theme: "sepia" },
  { id: "retro", label: "Retro 98", style: "retro", gradient: "lagoon", accent: "#000080", glow: "none", theme: "light" },
  { id: "classic", label: "Classic", style: "glass", gradient: "aurora", accent: "#8b5cf6", glow: "subtle" },
  { id: "nord", label: "Nord", style: "glass", gradient: "arctic", accent: "#88c0d0", glow: "subtle", theme: "nord" },
  { id: "dracula", label: "Dracula", style: "glass", gradient: "dusk", accent: "#bd93f9", glow: "subtle", theme: "dracula" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", style: "liquid", gradient: "dusk", accent: "#cba6f7", glow: "subtle", theme: "catppuccin-mocha" },
  { id: "catppuccin-latte", label: "Catppuccin Latte", style: "soft", gradient: "dawn", accent: "#8839ef", glow: "subtle", theme: "catppuccin-latte" },
  { id: "solarized", label: "Solarized", style: "solid", gradient: "deep-sea", accent: "#268bd2", glow: "subtle", theme: "solarized" },
  { id: "gruvbox", label: "Gruvbox", style: "solid", gradient: "ember", accent: "#fe8019", glow: "subtle", theme: "gruvbox" },
  { id: "tokyo-night", label: "Tokyo Night", style: "glass", gradient: "cyberpunk", accent: "#7aa2f7", glow: "strong", theme: "tokyo-night" },
  { id: "discord", label: "Discord", style: "solid", gradient: "midnight-blurple", accent: "#5865f2", glow: "subtle", theme: "discord-dark" },
  { id: "discord-onyx", label: "Onyx", style: "solid", gradient: "midnight-blurple", accent: "#5865f2", glow: "subtle", theme: "discord-onyx" },
  { id: "chroma-glow", label: "Chroma Glow", style: "liquid", gradient: "chroma-glow", accent: "#0e9ab4", glow: "strong", theme: "discord-onyx" },
  { id: "neon-nights", label: "Neon Nights", style: "neon", gradient: "neon-nights", accent: "#01a89e", glow: "strong", theme: "discord-dark" },
  { id: "crimson-moon", label: "Crimson Moon", style: "glass", gradient: "crimson-moon", accent: "#e23b3b", glow: "subtle", theme: "discord-onyx" },
  { id: "mint-apple", label: "Mint Apple", style: "glass", gradient: "mint-apple", accent: "#56b69f", glow: "subtle", theme: "discord-ash" },
  { id: "retro-raincloud", label: "Retro Raincloud", style: "glass", gradient: "retro-raincloud", accent: "#7f7eb9", glow: "subtle", theme: "discord-ash" },
  { id: "lofi-vibes", label: "Lofi Vibes", style: "soft", gradient: "lofi-vibes", accent: "#5b8def", glow: "subtle", theme: "discord-dark" },
  { id: "strawberry-lemonade", label: "Strawberry Lemonade", style: "liquid", gradient: "strawberry-lemonade", accent: "#e7c33a", glow: "subtle", theme: "discord-dark" },
  { id: "cotton-candy", label: "Cotton Candy", style: "soft", gradient: "cotton-candy", accent: "#d97fc0", glow: "subtle", theme: "discord-light" },
  { id: "hanami", label: "Hanami", style: "soft", gradient: "hanami", accent: "#d9707f", glow: "subtle", theme: "discord-light" },
];

/**
 * A colour theme from a few colours: the page, the card surface, text and status colours. Built-in
 * palettes (Nord, Dracula…) and the themes made in Settings both go through themeVars().
 */
export interface ThemeColors {
  page: string;
  /** Card colour; drawn at `surfaceOpacity` so the background still shows through glass styles. */
  surface: string;
  fg: string;
  accent?: string;
  ok?: string;
  warn?: string;
  err?: string;
  surfaceOpacity?: number;
}

export interface PaletteTheme {
  label: string;
  base: "dark" | "light";
  colors: ThemeColors;
}

export const paletteThemes: Record<string, PaletteTheme> = {
  nord: { label: "Nord", base: "dark", colors: { page: "#2e3440", surface: "#3b4252", fg: "#eceff4", accent: "#88c0d0", ok: "#a3be8c", warn: "#ebcb8b", err: "#bf616a" } },
  dracula: { label: "Dracula", base: "dark", colors: { page: "#282a36", surface: "#44475a", fg: "#f8f8f2", accent: "#bd93f9", ok: "#50fa7b", warn: "#f1fa8c", err: "#ff5555" } },
  "catppuccin-mocha": { label: "Catppuccin Mocha", base: "dark", colors: { page: "#1e1e2e", surface: "#313244", fg: "#cdd6f4", accent: "#cba6f7", ok: "#a6e3a1", warn: "#f9e2af", err: "#f38ba8" } },
  "catppuccin-latte": { label: "Catppuccin Latte", base: "light", colors: { page: "#eff1f5", surface: "#e6e9ef", fg: "#4c4f69", accent: "#8839ef", ok: "#40a02b", warn: "#df8e1d", err: "#d20f39", surfaceOpacity: 0.7 } },
  solarized: { label: "Solarized", base: "dark", colors: { page: "#002b36", surface: "#073642", fg: "#eee8d5", accent: "#268bd2", ok: "#859900", warn: "#b58900", err: "#dc322f" } },
  gruvbox: { label: "Gruvbox", base: "dark", colors: { page: "#282828", surface: "#3c3836", fg: "#ebdbb2", accent: "#fe8019", ok: "#b8bb26", warn: "#fabd2f", err: "#fb4934" } },
  "tokyo-night": { label: "Tokyo Night", base: "dark", colors: { page: "#1a1b26", surface: "#24283b", fg: "#c0caf5", accent: "#7aa2f7", ok: "#9ece6a", warn: "#e0af68", err: "#f7768e" } },
  "discord-dark": { label: "Discord Dark", base: "dark", colors: { page: "#313338", surface: "#2b2d31", fg: "#f2f3f5", accent: "#5865f2", ok: "#23a55a", warn: "#f0b232", err: "#f23f43", surfaceOpacity: 0.75 } },
  "discord-ash": { label: "Discord Ash", base: "dark", colors: { page: "#323339", surface: "#3b3c42", fg: "#f2f3f5", accent: "#5865f2", ok: "#23a55a", warn: "#f0b232", err: "#f23f43", surfaceOpacity: 0.7 } },
  "discord-onyx": { label: "Discord Onyx", base: "dark", colors: { page: "#070709", surface: "#121214", fg: "#ececee", accent: "#5865f2", ok: "#23a55a", warn: "#f0b232", err: "#f23f43", surfaceOpacity: 0.7 } },
  "discord-light": { label: "Discord Light", base: "light", colors: { page: "#f2f3f5", surface: "#ffffff", fg: "#060607", accent: "#5865f2", ok: "#1a8b4c", warn: "#a86f00", err: "#d22d39", surfaceOpacity: 0.7 } },
};

/** Starting colours for a new custom theme, per built-in theme. */
export const baseThemeColors: Record<string, PaletteTheme> = {
  dark: { label: "Dark", base: "dark", colors: { page: "#0b0b14", surface: "#1b1b2a", fg: "#f4f4f5", accent: "#8b5cf6", ok: "#34d399", warn: "#fbbf24", err: "#fb7185", surfaceOpacity: 0.45 } },
  light: { label: "Light", base: "light", colors: { page: "#eef1f8", surface: "#ffffff", fg: "#0f172a", accent: "#8b5cf6", ok: "#059669", warn: "#d97706", err: "#e11d48", surfaceOpacity: 0.55 } },
  oled: { label: "OLED", base: "dark", colors: { page: "#000000", surface: "#101014", fg: "#ffffff", accent: "#8b5cf6", ok: "#34d399", warn: "#fbbf24", err: "#fb7185", surfaceOpacity: 0.6 } },
  sepia: { label: "Sepia", base: "light", colors: { page: "#f3ead8", surface: "#fff9ed", fg: "#3b2f22", accent: "#c2410c", ok: "#4d7c0f", warn: "#b45309", err: "#b91c1c", surfaceOpacity: 0.6 } },
  ...paletteThemes,
};

/** A theme made in Settings → Appearance (stored in settings.yaml under customThemes). */
export interface CustomTheme {
  id: string;
  label: string;
  base: "dark" | "light";
  colors: ThemeColors;
  gradient?: { base: string; blobs: [string, string, string] };
}

export const CUSTOM_PREFIX = "custom:";

/** The palette (colours) behind a theme setting, or none for dark / light / system / oled / sepia. */
export function themePalette(theme: string, custom: CustomTheme[] = []): PaletteTheme | undefined {
  if (theme.startsWith(CUSTOM_PREFIX)) return custom.find((t) => t.id === theme.slice(CUSTOM_PREFIX.length));
  return paletteThemes[theme];
}

const mix = (color: string, pct: number, other = "transparent") => `color-mix(in srgb, ${color} ${Math.round(pct * 10) / 10}%, ${other})`;

/** The CSS variables for a palette. Accent stays with the accent setting. */
export function themeVars(p: PaletteTheme): Record<string, string> {
  const c = p.colors;
  const op = Math.min(1, Math.max(0, c.surfaceOpacity ?? (p.base === "light" ? 0.6 : 0.55))) * 100;
  const vars: Record<string, string> = {
    "--page": c.page,
    "--surface": c.surface,
    "--fg": c.fg,
    "--fg-muted": mix(c.fg, 64),
    "--glass": mix(c.surface, op),
    "--glass-hover": mix(c.surface, Math.min(100, op + 18)),
    "--glass-border": mix(c.fg, 14),
    "--glass-highlight": mix(c.fg, 9),
    "--scrim": mix(c.page, 25),
    "--chip": mix(c.page, 35),
    "--chip-ring": mix(c.fg, 6),
    "--track": mix(c.fg, 11),
    "--hover": mix(c.fg, 8),
    "--row": mix(c.fg, 3.5),
    "--dialog": mix(c.page, 92),
    "--grid": mix(c.fg, 8),
    "--axis": mix(c.fg, 18),
  };
  if (c.ok) vars["--ok"] = c.ok;
  if (c.warn) vars["--warn"] = c.warn;
  if (c.err) vars["--err"] = c.err;
  return vars;
}

/**
 * The stylesheet for a palette theme. `[data-palette]` on <html> outranks the light/dark token sets;
 * card styles that need an opaque or fainter pane keep that look with the palette's colours.
 */
export function paletteCss(p: PaletteTheme | undefined): string {
  if (!p) return "";
  const decl = Object.entries(themeVars(p))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return (
    `:root[data-palette]{${decl}}` +
    `:root[data-palette][data-style="solid"]{--glass:var(--surface);--glass-hover:${mix("var(--surface)", 90, "var(--fg)")}}` +
    `:root[data-palette][data-style="minimal"]{--glass:${mix("var(--surface)", 25)}}` +
    `:root[data-palette] .bg-preset{background:var(--page)}`
  );
}

const PLAIN_THEMES = new Set(["dark", "light", "system", "oled", "sepia"]);

/** The data-theme / data-tone attributes and palette for any theme setting. */
export function resolveTheme(theme: string, custom: CustomTheme[] = []): { theme: string; tone?: string; palette?: PaletteTheme } {
  const palette = themePalette(theme, custom);
  if (palette) return { theme: palette.base, palette };
  return themeAttrs(PLAIN_THEMES.has(theme) ? theme : "dark");
}

/** Gradient colours for a background.gradient value, including a custom theme's ("custom:<id>"). */
export function gradientFor(gradient: string, custom: CustomTheme[] = []): { base: string; blobs: [string, string, string]; swatch?: string } {
  if (gradient.startsWith(CUSTOM_PREFIX)) {
    const g = custom.find((t) => t.id === gradient.slice(CUSTOM_PREFIX.length))?.gradient;
    if (g) return g;
  }
  return gradientColors[gradient] ?? gradientColors.aurora;
}

/** WCAG contrast ratio between two hex colours (1–21); NaN when either isn't a hex colour. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
    if (!m) return NaN;
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The attributes for a theme setting: oled and sepia are tones on top of dark and light, so every
 * light/dark rule (and each style's light variant) keeps applying.
 */
export function themeAttrs(theme: string): { theme: string; tone?: string } {
  if (theme === "oled") return { theme: "dark", tone: "oled" };
  if (theme === "sepia") return { theme: "light", tone: "sepia" };
  return { theme };
}

/** The glow setting as 0–100: a number, or one of the old levels. */
export const GLOW_ALIASES: Record<string, number> = { none: 0, subtle: 50, strong: 100 };

export function glowAmount(glow: string | number | undefined): number {
  if (typeof glow === "number" && Number.isFinite(glow)) return Math.min(100, Math.max(0, glow));
  return GLOW_ALIASES[String(glow)] ?? GLOW_ALIASES.subtle;
}

/** data-glow for the styles that switch on it: none at 0, strong from 75. */
export function glowAttr(glow: string | number | undefined): "none" | "subtle" | "strong" {
  const n = glowAmount(glow);
  return n === 0 ? "none" : n >= 75 ? "strong" : "subtle";
}

export const DEFAULT_ACCENT = "#8b5cf6";

/** The accent to render on the server; "auto" with a wallpaper image is refined in the browser. */
export function serverAccent(accent: string, gradient: string, custom: CustomTheme[] = []): string {
  if (accent !== "auto") return accent;
  return gradientFor(gradient, custom).blobs[0] ?? DEFAULT_ACCENT;
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
