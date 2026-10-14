"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { RotateCcw, Trash2, Upload } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { fontFamily, fontIds } from "@/lib/fonts";
import type { Settings, UserPrefs } from "@/lib/config/schema";
import type { CustomTheme } from "@/lib/theme";
import { Dialog } from "../edit/Dialog";
import { inputClass, uploadFile } from "../edit/FieldInput";
import { applyTheme, GradientPicker, setFont, setGlow, StylePicker, ThemePicker } from "../settings/LookPickers";
import { glowAmount } from "@/lib/theme";
import { useT } from "@/i18n/client";

const KEY = "/api/profile/prefs";
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
type Defaults = Pick<Settings, "language" | "theme" | "style" | "accent" | "glow" | "font" | "background"> & { customThemes: CustomTheme[] };
type Answer = { prefs: UserPrefs; defaults: Defaults };
type Bg = NonNullable<UserPrefs["background"]>;

/**
 * Your own look: theme, card style, accent, glow, font, language and wallpaper. Anything left
 * alone follows the global settings, which only admins change. Changes preview at once.
 */
export function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { data, mutate } = useSWR<Answer>(KEY, fetcher);
  const [draft, setDraft] = useState<UserPrefs>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const saved = useRef(false);
  useEffect(() => {
    if (data && !draft) setDraft(data.prefs);
  }, [data, draft]);

  const d = data?.defaults;
  const p = draft ?? {};
  const look = d && {
    theme: p.theme ?? d.theme,
    style: p.style ?? d.style,
    accent: p.accent ?? d.accent,
    glow: p.glow ?? d.glow,
    font: p.font ?? d.font,
    language: p.language ?? d.language,
    gradient: p.background?.gradient ?? d.background.gradient,
    brightness: p.background?.brightness ?? d.background.brightness,
    blur: p.background?.blur ?? d.background.blur,
  };

  // Live preview on the page; put back the look it had when this closes without saving.
  useEffect(() => {
    const root = document.documentElement;
    const before = {
      theme: root.dataset.theme,
      tone: root.dataset.tone,
      palette: root.dataset.palette,
      style: root.dataset.style,
      glow: root.dataset.glow,
      vars: ["--accent", "--glow", "--font-choice"].map((v) => [v, root.style.getPropertyValue(v)] as const),
      css: document.getElementById("page-palette")?.textContent ?? "",
    };
    return () => {
      if (saved.current) return;
      Object.assign(root.dataset, { theme: before.theme, style: before.style, glow: before.glow });
      if (before.tone) root.dataset.tone = before.tone;
      else delete root.dataset.tone;
      if (before.palette !== undefined) root.dataset.palette = before.palette;
      else delete root.dataset.palette;
      for (const [v, value] of before.vars) if (value) root.style.setProperty(v, value);
      else root.style.removeProperty(v);
      const style = document.getElementById("page-palette");
      if (style) style.textContent = before.css;
    };
  }, []);
  useEffect(() => {
    if (!look || !d || !draft) return;
    const root = document.documentElement;
    applyTheme(root, look.theme, d.customThemes);
    root.dataset.style = look.style;
    setGlow(root, look.glow);
    if (HEX.test(look.accent)) root.style.setProperty("--accent", look.accent);
    setFont(root, fontFamily(look.font));
  }, [look?.theme, look?.style, look?.glow, look?.accent, look?.font, d, draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: UserPrefs) => setDraft({ ...p, ...patch });
  const setBg = (patch: Bg) => setDraft({ ...p, background: { ...p.background, ...patch } });

  const changeWallpaper = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(undefined);
    try {
      const url = await uploadFile("/api/profile/background", file);
      setBg({ image: url });
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const removeWallpaper = async () => {
    setError(undefined);
    try {
      await sendJson("/api/profile/background", "DELETE");
      const { image: _, ...rest } = p.background ?? {}; // eslint-disable-line @typescript-eslint/no-unused-vars
      setDraft({ ...p, background: rest });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const finish = () => {
    saved.current = true;
    // The page's look and wallpaper are drawn on the server: load it again.
    window.location.reload();
  };
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // null: back to the global setting.
      await sendJson(KEY, "PATCH", {
        theme: p.theme ?? null,
        style: p.style ?? null,
        accent: p.accent ?? null,
        glow: p.glow ?? null,
        font: p.font ?? null,
        language: p.language ?? null,
        background: { gradient: p.background?.gradient ?? null, brightness: p.background?.brightness ?? null, blur: p.background?.blur ?? null },
      });
      finish();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      await sendJson(KEY, "PATCH", { reset: true });
      finish();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const label = "text-xs font-medium text-muted";
  return (
    <Dialog title={t("Your appearance")} onClose={onClose} onSubmit={save} error={error} busy={busy || !look}>
      {!look || !d ? (
        <p className="text-sm text-muted">{t("Loading…")}</p>
      ) : (
        <>
          <p className="-mt-1 text-sm text-muted">{t("Only for you. Anything you leave alone follows the dashboard's settings.")}</p>
          <ThemePicker value={look.theme} custom={d.customThemes} onChange={(v) => set({ theme: v })} />
          <StylePicker value={look.style} onChange={(v) => set({ style: v as UserPrefs["style"] })} />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={label}>{t("Accent colour")}</span>
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  value={HEX.test(look.accent) ? look.accent : "#8b5cf6"}
                  disabled={look.accent === "auto"}
                  onChange={(e) => set({ accent: e.target.value })}
                  className="h-9 w-12 cursor-pointer rounded-lg bg-transparent disabled:opacity-40"
                />
                <span className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={look.accent === "auto"} onChange={(e) => set({ accent: e.target.checked ? "auto" : "#8b5cf6" })} />
                  {t("From the wallpaper")}
                </span>
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={label}>
                {t("Hover glow")} · {glowAmount(look.glow)}
              </span>
              <input type="range" min={0} max={100} step={5} value={glowAmount(look.glow)} onChange={(e) => set({ glow: Number(e.target.value) })} className="accent-[var(--accent)]" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={label}>{t("Font")}</span>
              <select value={look.font} onChange={(e) => set({ font: e.target.value as UserPrefs["font"] })} className={inputClass}>
                {fontIds.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={label}>{t("Language")}</span>
              <select value={look.language} onChange={(e) => set({ language: e.target.value as UserPrefs["language"] })} className={inputClass}>
                <option value="auto">{t("Same as the browser")}</option>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </select>
            </label>
          </div>

          <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
            <legend className="sr-only">{t("Background")}</legend>
            <span className="text-sm font-semibold">{t("Background")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`flex cursor-pointer items-center gap-1.5 rounded-full bg-track px-3 py-1.5 text-sm hover:bg-hover ${uploading ? "pointer-events-none opacity-60" : ""}`}>
                <Upload className="h-4 w-4" /> {uploading ? t("Uploading…") : p.background?.image ? t("Change wallpaper") : t("Upload a wallpaper")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  className="sr-only"
                  onChange={(e) => {
                    void changeWallpaper(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {p.background?.image && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.background.image} alt="" className="h-9 w-14 rounded-lg object-cover ring-1 ring-line" />
                  <button type="button" onClick={removeWallpaper} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
                    <Trash2 className="h-4 w-4" /> {t("Remove")}
                  </button>
                </>
              )}
            </div>
            <p className="-mt-1 text-xs text-muted">{t("PNG, JPEG, WebP, GIF or AVIF up to 15 MB. Without one, the gradient below is used.")}</p>
            <GradientPicker value={look.gradient} custom={d.customThemes} onChange={(v) => setBg({ gradient: v })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className={label}>
                  {t("Image brightness")} · {look.brightness}
                </span>
                <input type="range" min={0} max={1} step={0.05} value={look.brightness} onChange={(e) => setBg({ brightness: Number(e.target.value) })} className="accent-[var(--accent)]" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={label}>
                  {t("Image blur (px)")} · {look.blur}
                </span>
                <input type="range" min={0} max={40} step={1} value={look.blur} onChange={(e) => setBg({ blur: Number(e.target.value) })} className="accent-[var(--accent)]" />
              </label>
            </div>
          </fieldset>

          {Object.keys(data.prefs).length > 0 && (
            <button type="button" onClick={reset} disabled={busy} className="flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
              <RotateCcw className="h-4 w-4" /> {t("Back to the dashboard's look")}
            </button>
          )}
        </>
      )}
    </Dialog>
  );
}
