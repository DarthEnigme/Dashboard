import { describe, expect, it } from "vitest";
import { settingsSchema, gradientPresets } from "@/lib/config/schema";
import { changedFields, validateSettings } from "@/components/settings/validate";
import { parseThemeImport } from "@/components/settings/ThemeEditor";
import {
  contrastRatio,
  glowAmount,
  glowAttr,
  gradientColors,
  gradientFor,
  lookPresets,
  paletteCss,
  paletteThemes,
  resolveTheme,
  serverAccent,
  themeVars,
  type CustomTheme,
} from "@/lib/theme";

const mint: CustomTheme = {
  id: "mint-paper",
  label: "Mint paper",
  base: "light",
  colors: { page: "#e8f5ee", surface: "#ffffff", fg: "#1f3b2d", accent: "#10b981" },
  gradient: { base: "#e8f5ee", blobs: ["#10b981", "#a7f3d0", "#0ea5e9"] },
};

describe("hover glow", () => {
  it("reads numbers and the old levels", () => {
    expect(glowAmount("none")).toBe(0);
    expect(glowAmount("subtle")).toBe(50);
    expect(glowAmount("strong")).toBe(100);
    expect(glowAmount(35)).toBe(35);
    expect(glowAmount(140)).toBe(100);
    expect(glowAmount(undefined)).toBe(50);
  });

  it("maps to the data-glow levels the card styles switch on", () => {
    expect(glowAttr(0)).toBe("none");
    expect(glowAttr(40)).toBe("subtle");
    expect(glowAttr(75)).toBe("strong");
    expect(glowAttr("none")).toBe("none");
  });

  it("accepts both forms in settings.yaml", () => {
    expect(settingsSchema.parse({ glow: "strong" }).glow).toBe("strong");
    expect(settingsSchema.parse({ glow: 65 }).glow).toBe(65);
    expect(settingsSchema.safeParse({ glow: 150 }).success).toBe(false);
    expect(settingsSchema.safeParse({ glow: "blinding" }).success).toBe(false);
  });
});

describe("themes", () => {
  it("every gradient preset has colours, and every look points at real ones", () => {
    for (const g of gradientPresets) expect(gradientColors[g], g).toBeDefined();
    for (const l of lookPresets) {
      expect(gradientColors[l.gradient], l.id).toBeDefined();
      if (l.theme) expect(settingsSchema.safeParse({ theme: l.theme }).success, l.id).toBe(true);
    }
  });

  it("validates theme names", () => {
    expect(settingsSchema.parse({ theme: "nord" }).theme).toBe("nord");
    expect(settingsSchema.parse({ theme: "custom:mine" }).theme).toBe("custom:mine");
    expect(settingsSchema.safeParse({ theme: "neon-pink" }).success).toBe(false);
    expect(settingsSchema.parse({ background: { gradient: "custom:mine" } }).background.gradient).toBe("custom:mine");
    expect(settingsSchema.safeParse({ background: { gradient: "plaid" } }).success).toBe(false);
  });

  it("validates custom themes", () => {
    expect(settingsSchema.parse({ customThemes: [mint] }).customThemes[0].label).toBe("Mint paper");
    expect(settingsSchema.safeParse({ customThemes: [mint, mint] }).success).toBe(false);
    expect(settingsSchema.safeParse({ customThemes: [{ ...mint, colors: { ...mint.colors, fg: "green" } }] }).success).toBe(false);
    expect(settingsSchema.safeParse({ customThemes: [{ ...mint, id: "Mint Paper" }] }).success).toBe(false);
  });

  it("resolves palettes on top of dark or light, and falls back for unknown ones", () => {
    expect(resolveTheme("nord")).toMatchObject({ theme: "dark", palette: paletteThemes.nord });
    expect(resolveTheme("catppuccin-latte").theme).toBe("light");
    expect(resolveTheme("custom:mint-paper", [mint])).toMatchObject({ theme: "light", palette: mint });
    expect(resolveTheme("custom:gone", [mint])).toEqual({ theme: "dark" });
    expect(resolveTheme("oled")).toEqual({ theme: "dark", tone: "oled" });
  });

  it("derives the full token set from a few colours", () => {
    const v = themeVars(mint);
    expect(v["--page"]).toBe("#e8f5ee");
    expect(v["--fg"]).toBe("#1f3b2d");
    expect(v["--glass"]).toBe("color-mix(in srgb, #ffffff 60%, transparent)");
    expect(v["--ok"]).toBeUndefined();
    const css = paletteCss(mint);
    expect(css).toContain(":root[data-palette]{--page:#e8f5ee;");
    expect(css).toContain('[data-style="solid"]');
    expect(paletteCss(undefined)).toBe("");
  });

  it("custom gradients feed the background and the auto accent", () => {
    expect(gradientFor("custom:mint-paper", [mint]).blobs[0]).toBe("#10b981");
    expect(gradientFor("custom:gone", [mint])).toBe(gradientColors.aurora);
    expect(serverAccent("auto", "custom:mint-paper", [mint])).toBe("#10b981");
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#fff", "#fff")).toBe(1);
    expect(contrastRatio("#1f3b2d", "#e8f5ee")).toBeGreaterThan(4.5);
    expect(contrastRatio("#eeeeee", "#e8f5ee")).toBeLessThan(1.2);
    expect(contrastRatio("green", "#fff")).toBeNaN();
  });

  it("imports shared themes with fresh ids", () => {
    const one = parseThemeImport(JSON.stringify(mint), ["mint-paper"]);
    expect(one[0].id).toBe("mint-paper-2");
    const two = parseThemeImport(JSON.stringify([mint, { ...mint, id: undefined, label: "Dé jà" }]), []);
    expect(two.map((t) => t.id)).toEqual(["mint-paper", "de-ja"]);
    expect(() => parseThemeImport('{"label":"x"}', [])).toThrow(/Not a Page theme/);
  });

  it("counts custom theme edits as unsaved changes", () => {
    expect(changedFields({ customThemes: [mint] }, {})).toContain("customThemes");
    expect(validateSettings({ customThemes: [mint, mint] }).errors.customThemes).toMatch(/same id/);
  });
});
