"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Copy, Download, FileUp, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { baseThemeColors, contrastRatio, CUSTOM_PREFIX, type CustomTheme, type ThemeColors } from "@/lib/theme";
import { inputBase, inputClass } from "../edit/FieldInput";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n";

const colorFields: { key: keyof ThemeColors; label: string; help?: string }[] = [
  { key: "page", label: msg("Background") },
  { key: "surface", label: msg("Cards") },
  { key: "fg", label: msg("Text") },
  { key: "accent", label: msg("Accent"), help: msg("Applied with the theme") },
  { key: "ok", label: "OK" },
  { key: "warn", label: msg("Warning") },
  { key: "err", label: msg("Error") },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "theme";

function uniqueId(base: string, taken: string[]) {
  let id = slug(base);
  for (let n = 2; taken.includes(id); n++) id = `${slug(base)}-${n}`;
  return id;
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** Accepts one theme or a list, as exported here; ids are made unique against the existing ones. */
export function parseThemeImport(text: string, taken: string[]): CustomTheme[] {
  const data = JSON.parse(text) as unknown;
  const list = (Array.isArray(data) ? data : [data]) as Partial<CustomTheme>[];
  const out: CustomTheme[] = [];
  for (const t of list) {
    if (!t || typeof t !== "object" || !t.colors?.page || !t.colors.surface || !t.colors.fg) throw new Error("Not a Page theme: needs colors.page, surface and fg");
    const id = uniqueId(t.id ?? t.label ?? "theme", [...taken, ...out.map((o) => o.id)]);
    out.push({ id, label: String(t.label ?? id).slice(0, 40), base: t.base === "light" ? "light" : "dark", colors: t.colors, ...(t.gradient ? { gradient: t.gradient } : {}) });
  }
  return out;
}

/**
 * Settings → Appearance → Custom themes: make colour themes from a few colours, preview them live
 * (the theme being edited is applied while it's selected), and share them as JSON.
 */
export function ThemeEditor({
  themes,
  current,
  error,
  onChange,
  onUse,
}: {
  themes: CustomTheme[];
  current: string;
  error?: string;
  onChange: (list: CustomTheme[]) => void;
  onUse: (t: CustomTheme) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string>();
  const [from, setFrom] = useState("dark");
  const [importError, setImportError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const ids = themes.map((t) => t.id);

  const update = (id: string, patch: Partial<CustomTheme>) => onChange(themes.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const create = () => {
    const seed = baseThemeColors[from] ?? baseThemeColors.dark;
    const id = uniqueId(`my-${slug(seed.label)}`, ids);
    const t: CustomTheme = { id, label: `My ${seed.label}`, base: seed.base, colors: { ...seed.colors } };
    onChange([...themes, t]);
    setEditing(id);
    onUse(t);
  };

  const importFile = async (f: File) => {
    try {
      const added = parseThemeImport(await f.text(), ids);
      onChange([...themes, ...added]);
      setImportError(undefined);
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  return (
    <div id="themes" className="flex scroll-mt-6 flex-col gap-3 border-t border-line pt-5">
      <h3 className="text-sm font-semibold tracking-wider text-muted uppercase">{t("Custom themes")}</h3>
      <p className="-mt-1 text-xs text-muted">{t("Pick a few colours; everything else (borders, hovers, charts grid) is derived from them. The theme you edit is previewed while it's selected.")}</p>

      {themes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {themes.map((th) => {
            const active = current === `${CUSTOM_PREFIX}${th.id}`;
            return (
              <li key={th.id} className="rounded-2xl ring-1 ring-line" data-custom-theme={th.id}>
                <div className="flex flex-wrap items-center gap-2 p-2">
                  <span aria-hidden className="flex h-9 w-14 items-end gap-0.5 rounded-lg p-1 ring-1 ring-line" style={{ background: th.colors.page }}>
                    {[th.colors.surface, th.colors.accent, th.colors.fg].map((c, i) => (
                      <span key={i} className="h-3 flex-1 rounded-sm" style={{ background: c ?? "transparent" }} />
                    ))}
                  </span>
                  <span className="mr-auto min-w-0">
                    <span className="block truncate text-sm font-medium">{th.label}</span>
                    <span className="block text-xs text-muted">
                      {th.base} · {th.id}
                    </span>
                  </span>
                  {active ? (
                    <span className="rounded-full bg-accent/20 px-3 py-1 text-xs font-medium text-accent">{t("In use")}</span>
                  ) : (
                    <button type="button" onClick={() => onUse(th)} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white hover:brightness-110">
                      {t("Use")}
                    </button>
                  )}
                  <IconButton label={t("Edit {name}", { name: th.label })} onClick={() => setEditing(editing === th.id ? undefined : th.id)} pressed={editing === th.id}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={t("Duplicate {name}", { name: th.label })}
                    onClick={() => onChange([...themes, { ...structuredClone(th), id: uniqueId(`${th.id}-copy`, ids), label: t("{name} copy", { name: th.label }).slice(0, 40) }])}
                  >
                    <Copy className="h-4 w-4" />
                  </IconButton>
                  <IconButton label={t("Export {name}", { name: th.label })} onClick={() => download(`${th.id}.page-theme.json`, th)}>
                    <Download className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={active ? t("Pick another theme before deleting this one") : t("Delete {name}", { name: th.label })}
                    disabled={active}
                    onClick={() => onChange(themes.filter((x) => x.id !== th.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
                {editing === th.id && <ThemeForm theme={th} onChange={(patch) => update(th.id, patch)} />}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="flex items-center gap-1 text-xs text-[var(--err)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t("Start from")}</span>
          <select aria-label={t("Start from")} value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputBase} w-44`}>
            {Object.entries(baseThemeColors).map(([id, th]) => (
              <option key={id} value={id}>
                {th.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={create} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("New theme")}
        </button>
        <button type="button" onClick={() => file.current?.click()} className="flex items-center gap-1.5 rounded-full bg-track px-4 py-2 text-sm hover:bg-hover">
          <FileUp className="h-4 w-4" /> {t("Import JSON")}
        </button>
        {themes.length > 1 && (
          <button type="button" onClick={() => download("page-themes.json", themes)} className="flex items-center gap-1.5 rounded-full bg-track px-4 py-2 text-sm hover:bg-hover">
            <Download className="h-4 w-4" /> {t("Export all")}
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {importError && <p className="text-xs text-[var(--err)]">{importError}</p>}
    </div>
  );
}

function IconButton({ label, onClick, pressed, disabled, children }: { label: string; onClick: () => void; pressed?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:bg-hover aria-pressed:text-fg"
    >
      {children}
    </button>
  );
}

function ThemeForm({ theme, onChange }: { theme: CustomTheme; onChange: (patch: Partial<CustomTheme>) => void }) {
  const t = useT();
  const c = theme.colors;
  const setColor = (key: keyof ThemeColors, v: string | number | undefined) => onChange({ colors: { ...c, [key]: v } });
  const text = contrastRatio(c.fg, c.page);
  const onCards = contrastRatio(c.fg, c.surface);
  const low = Math.min(text, onCards);
  const g = theme.gradient;

  return (
    <div className="grid gap-4 border-t border-line p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          {t("Name")}
          <input value={theme.label} maxLength={40} onChange={(e) => onChange({ label: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          {t("Based on")}
          <select value={theme.base} onChange={(e) => onChange({ base: e.target.value as "dark" | "light" })} className={inputClass}>
            <option value="dark">{t("dark (light text, dark panes)")}</option>
            <option value="light">{t("light (dark text, bright panes)")}</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {colorFields.map((f) => (
          <ColorInput key={f.key} label={f.label} value={c[f.key] as string | undefined} optional={!["page", "surface", "fg"].includes(f.key)} onChange={(v) => setColor(f.key, v)} />
        ))}
      </div>

      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
        {t("Card opacity")}
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={c.surfaceOpacity ?? (theme.base === "light" ? 0.6 : 0.55)}
            onChange={(e) => setColor("surfaceOpacity", Number(e.target.value))}
            className="h-8 flex-1 accent-[var(--accent)]"
          />
          <span className="w-12 text-right text-sm text-fg tabular-nums">{Math.round((c.surfaceOpacity ?? (theme.base === "light" ? 0.6 : 0.55)) * 100)}%</span>
        </div>
      </label>

      <p className={`flex items-center gap-1.5 text-xs ${low < 4.5 ? "text-[var(--warn)]" : "text-muted"}`} role={low < 4.5 ? "alert" : undefined}>
        {low < 4.5 && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
        {t("Text contrast")}{" "}{Number.isFinite(text) ? text.toFixed(1) : "?"}{t(":1 on the background,")}{" "}{Number.isFinite(onCards) ? onCards.toFixed(1) : "?"}{t(":1 on cards")}
        {low < 4.5 ? t(" — below 4.5:1, text will be hard to read.") : "."}
      </p>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!g}
            onChange={(e) => onChange({ gradient: e.target.checked ? { base: c.page, blobs: [c.accent ?? "#8b5cf6", c.surface, c.ok ?? c.fg] } : undefined })}
            className="accent-[var(--accent)]"
          />
          {t("Own background gradient")}
          <Wand2 className="h-3.5 w-3.5 text-muted" aria-hidden />
        </label>
        {g && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ColorInput label={t("Gradient base")} value={g.base} onChange={(v) => onChange({ gradient: { ...g, base: v ?? g.base } })} />
            {g.blobs.map((b, i) => (
              <ColorInput
                key={i}
                label={t("Glow {n}", { n: i + 1 })}
                value={b}
                onChange={(v) => {
                  const blobs = [...g.blobs] as [string, string, string];
                  blobs[i] = v ?? b;
                  onChange({ gradient: { ...g, blobs } });
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ColorInput({ label, value, optional, onChange }: { label: string; value?: string; optional?: boolean; onChange: (v: string | undefined) => void }) {
  const t = useT();
  label = t(label);
  const [text, setText] = useState(value ?? "");
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
      {label}
      <span className="flex gap-1.5">
        <input
          type="color"
          aria-label={t("{name} colour picker", { name: label })}
          value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#000000"}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
        />
        <input
          value={text}
          aria-label={label}
          placeholder={optional ? "default" : "#000000"}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            const v = e.target.value.trim();
            if (!v && optional) onChange(undefined);
            else if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) onChange(v);
          }}
          className={`${inputBase} h-9 w-full min-w-0 px-2 font-mono text-xs text-fg`}
        />
      </span>
    </label>
  );
}
