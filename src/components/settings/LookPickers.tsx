"use client";

import type { CSSProperties } from "react";
import { gradientPresets, stylePresets } from "@/lib/config/schema";
import { baseThemeColors, CUSTOM_PREFIX, glowAmount, glowAttr, gradientFor, paletteCss, paletteThemes, resolveTheme, type CustomTheme } from "@/lib/theme";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";

/*
 * Pickers and live preview for the look, shared by Settings → Appearance (the global look) and
 * each user's own Appearance dialog.
 */

export function setFont(root: HTMLElement, family: string | undefined) {
  if (family) root.style.setProperty("--font-choice", family);
  else root.style.removeProperty("--font-choice");
}

export function setGlow(root: HTMLElement, glow: string | number | undefined) {
  root.dataset.glow = glowAttr(glow);
  root.style.setProperty("--glow", String(glowAmount(glow) / 100));
}

export function applyTheme(root: HTMLElement, theme: string, custom: CustomTheme[] = []) {
  const a = resolveTheme(theme, custom);
  root.dataset.theme = a.theme;
  if (a.tone) root.dataset.tone = a.tone;
  else delete root.dataset.tone;
  if (a.palette) root.dataset.palette = "";
  else delete root.dataset.palette;
  const style = document.getElementById("page-palette");
  if (style) style.textContent = paletteCss(a.palette);
}

const plainThemes: { id: string; label: string; note: string }[] = [
  { id: "dark", label: msg("Dark"), note: msg("Default") },
  { id: "light", label: msg("Light"), note: msg("Bright panes") },
  { id: "system", label: msg("System"), note: msg("Follows the OS") },
  { id: "oled", label: "OLED", note: msg("Pure black") },
  { id: "sepia", label: msg("Sepia"), note: msg("Warm paper") },
];

/** Built-in themes, colour palettes and custom themes, each drawn in its own colours. */
export function ThemePicker({ value, custom, onChange }: { value: string; custom: CustomTheme[]; onChange: (v: string) => void }) {
  const t = useT();
  const options = [
    ...plainThemes.map((p) => ({ ...p, label: t(p.label), note: t(p.note), colors: baseThemeColors[p.id === "system" ? "dark" : p.id].colors })),
    ...Object.entries(paletteThemes).map(([id, p]) => ({ id, label: p.label, note: p.base === "light" ? t("Light palette") : t("Dark palette"), colors: p.colors })),
    ...custom.map((c) => ({ id: `${CUSTOM_PREFIX}${c.id}`, label: c.label, note: t("Custom"), colors: c.colors })),
  ];
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-muted">{t("Theme")}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {options.map((t) => (
          <label key={t.id} className="cursor-pointer" data-theme-option={t.id}>
            <input type="radio" name="theme" value={t.id} checked={value === t.id} onChange={() => onChange(t.id)} className="peer sr-only" />
            <div
              className="flex items-center gap-2.5 rounded-xl p-2 ring-1 ring-line transition peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
              style={{ background: t.colors.page, color: t.colors.fg }}
            >
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-end gap-0.5 rounded-lg p-1" style={{ background: t.colors.surface }}>
                {[t.colors.accent, t.colors.ok, t.colors.err].map((c, i) => (
                  <span key={i} className="h-2 flex-1 rounded-sm" style={{ background: c ?? "transparent" }} />
                ))}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{t.label}</span>
                <span className="block truncate text-[11px] opacity-70">{t.note}</span>
              </span>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const styleNotes: Record<(typeof stylePresets)[number], string> = {
  glass: msg("Frosted"),
  liquid: msg("Liquid glass"),
  aero: msg("Frutiger Aero"),
  neon: msg("Glowing edges"),
  brutal: msg("Bold & flat"),
  soft: msg("Neumorphic"),
  retro: msg("Windows 98"),
  minimal: msg("Light touch"),
  solid: msg("Opaque"),
};

/** Each option is drawn with its own style tokens (data-style scopes the CSS variables). */
export function StylePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-muted">{t("Card style")}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stylePresets.map((s) => (
          <label key={s} data-style={s} className="cursor-pointer">
            <input type="radio" name="style" value={s} checked={value === s} onChange={() => onChange(s)} className="peer sr-only" />
            <div className="glass flex h-20 flex-col justify-end rounded-2xl p-3 transition peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
              <span className="text-sm font-semibold capitalize">{s}</span>
              <span className="text-xs text-muted">{t(styleNotes[s])}</span>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function GradientPicker({ value, custom, onChange }: { value: string; custom: CustomTheme[]; onChange: (v: string) => void }) {
  const t = useT();
  const names: { id: string; label: string }[] = [
    ...gradientPresets.map((g) => ({ id: g as string, label: g.replaceAll("-", " ") })),
    ...custom.filter((t) => t.gradient).map((t) => ({ id: `${CUSTOM_PREFIX}${t.id}`, label: t.label })),
  ];
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-muted">{t("Gradient")}</legend>
      <div className="flex flex-wrap gap-3">
        {names.map(({ id: g, label }) => {
          const c = gradientFor(g, custom);
          const bg: CSSProperties = {
            background: c.swatch ?? `radial-gradient(circle at 20% 25%, ${c.blobs[0]} 0, transparent 55%), radial-gradient(circle at 85% 80%, ${c.blobs[1]} 0, transparent 55%), radial-gradient(circle at 50% 50%, ${c.blobs[2]} 0, transparent 60%), ${c.base}`,
          };
          return (
            <label key={g} className="flex cursor-pointer flex-col items-center gap-1.5 text-xs">
              <input type="radio" name="gradient" value={g} checked={value === g} onChange={() => onChange(g)} className="peer sr-only" />
              <span className="h-14 w-20 rounded-xl ring-1 ring-line transition peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent" style={bg} />
              <span className="capitalize">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
