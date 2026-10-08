"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Download, FileUp, Search, X } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { gradientPresets, stylePresets, type Settings } from "@/lib/config/schema";
import type { ClientSettings } from "@/lib/config/sanitize";
import { gradientColors, lookPresets, themeAttrs, type LookPreset } from "@/lib/theme";
import type { FieldSpec } from "@/integrations/fields";
import { Background } from "../Background";
import { LiveReload } from "../LiveReload";
import { FieldInput, type FormValue } from "../edit/FieldInput";
import { getPath, setPath } from "../edit/FieldsDialog";
import { UsersPanel } from "../edit/UsersPanel";
import { GroupsPanel } from "../edit/GroupsPanel";
import { AuditPanel } from "../edit/AuditPanel";
import { HistoryPanel } from "../edit/HistoryPanel";
import { ImportDialog } from "../edit/ImportDialog";
import { sections, type Section } from "./sections";
import { TestAlertButton } from "./TestAlertButton";
import { UpdatesPanel } from "./UpdatesPanel";
import { changedFields, validateSettings } from "./validate";

type Obj = Record<string, unknown>;

const HEX = /^#[0-9a-f]{3,8}$/i;

function clientSettings(s: Settings): ClientSettings {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth, ...rest } = s;
  return rest;
}

const matches = (f: FieldSpec, q: string) => [f.label, f.key, f.help ?? ""].some((t) => t.toLowerCase().includes(q));

export function SettingsApp({ initial, fallback, version }: { initial: Obj; fallback: ClientSettings; version?: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Obj>(initial);
  const [draft, setDraft] = useState<Obj>(initial);
  // Remount the inputs after loading from disk: list and YAML inputs keep their own text.
  const [generation, setGeneration] = useState(0);
  const [active, setActive] = useState(sections[0].id);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean }>();
  const [importing, setImporting] = useState(false);

  const { errors, parsed } = useMemo(() => validateSettings(draft), [draft]);
  const changed = useMemo(() => changedFields(draft, saved), [draft, saved]);
  const dirty = changed.length > 0;
  const errorCount = Object.keys(errors).length;

  // Keep the last valid draft for the preview while a field is half-typed.
  const lastGood = useRef<ClientSettings>(fallback);
  if (parsed) lastGood.current = clientSettings(parsed);
  const preview = lastGood.current;

  // Deep links: /settings#appearance
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (sections.some((s) => s.id === id)) setActive(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  // Live preview of theme, style and accent on the page itself; the saved look is restored when leaving.
  // `theme` holds the setting (dark, oled…); data-theme/data-tone are derived from it.
  const restore = useRef<{ theme?: string; style?: string; glow?: string; accent: string }>(undefined);
  useEffect(() => {
    const root = document.documentElement;
    restore.current = {
      theme: root.dataset.tone === "oled" ? "oled" : root.dataset.tone === "sepia" ? "sepia" : root.dataset.theme,
      style: root.dataset.style,
      glow: root.dataset.glow,
      accent: root.style.getPropertyValue("--accent"),
    };
    return () => {
      const r = restore.current!;
      applyTheme(root, r.theme ?? "dark");
      root.dataset.style = r.style;
      root.dataset.glow = r.glow;
      root.style.setProperty("--accent", r.accent);
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    applyTheme(root, preview.theme);
    root.dataset.style = preview.style;
    root.dataset.glow = preview.glow;
    if (HEX.test(preview.accent)) root.style.setProperty("--accent", preview.accent);
  }, [preview.theme, preview.style, preview.glow, preview.accent]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const raw = await fetcher<{ settings: Obj }>("/api/config?raw=1");
      setSaved(raw.settings);
      setDraft(raw.settings);
      setGeneration((g) => g + 1);
    } catch (e) {
      setToast({ message: (e as Error).message, error: true });
    }
  }, []);

  const save = async () => {
    if (errorCount) return;
    setBusy(true);
    try {
      await sendJson("/api/config", "PUT", { file: "settings", data: draft });
      setSaved(draft);
      if (restore.current) {
        restore.current = {
          theme: preview.theme,
          style: preview.style,
          glow: preview.glow,
          accent: HEX.test(preview.accent) ? preview.accent : restore.current.accent,
        };
      }
      setToast({ message: "Settings saved" });
      router.refresh();
    } catch (e) {
      setToast({ message: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    setDraft(saved);
    setGeneration((g) => g + 1);
  };

  const select = (id: string) => {
    setActive(id);
    setQuery("");
    window.history.replaceState(null, "", `#${id}`);
  };

  const q = query.trim().toLowerCase();
  const visible: { section: Section; fields: FieldSpec[] }[] = q
    ? sections.map((s) => ({ section: s, fields: s.fields.filter((f) => matches(f, q)) })).filter((x) => x.fields.length)
    : sections.filter((s) => s.id === active).map((s) => ({ section: s, fields: s.fields }));
  const changedIn = (s: Section) => s.fields.filter((f) => changed.includes(f.key)).length;
  const errorsIn = (s: Section) => s.fields.filter((f) => errors[f.key]).length;

  const field = (f: FieldSpec) => {
    const value = getPath(draft, f.key) as FormValue;
    const onChange = (v: FormValue) => setDraft((cur) => setPath(cur, f.key, v));
    return (
      <div key={`${generation}-${f.key}`} className="flex flex-col gap-1.5" data-field={f.key}>
        {f.key === "style" ? (
          <StylePicker value={(value as string) ?? "glass"} onChange={onChange} />
        ) : f.key === "background.gradient" ? (
          <GradientPicker value={(value as string) ?? "aurora"} onChange={onChange} />
        ) : (
          <FieldInput spec={f} value={value} onChange={onChange} />
        )}
        {errors[f.key] && (
          <p className="flex items-center gap-1 text-xs text-[var(--err)]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {errors[f.key]}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <Background settings={preview} />
      <LiveReload paused={dirty} onReload={() => void reload()} version={version} />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 pb-28 sm:px-6 lg:py-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="mb-2 flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
              <ArrowLeft className="h-4 w-4" /> Dashboard
            </Link>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          </div>
          <label className="glass flex h-11 w-full items-center gap-2 rounded-full px-4 focus-within:ring-2 focus-within:ring-accent/60 sm:w-72">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search settings…"
              aria-label="Search settings"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        </div>

        <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
          {/* Phones: a select; wider: a sidebar. */}
          <select
            aria-label="Section"
            value={active}
            onChange={(e) => select(e.target.value)}
            className="glass h-11 rounded-full px-4 text-sm lg:hidden"
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <nav aria-label="Settings sections" className="hidden lg:block">
            <ul className="glass sticky top-6 flex flex-col gap-0.5 rounded-2xl p-2">
              {sections.map((s) => {
                const n = changedIn(s);
                const e = errorsIn(s);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => select(s.id)}
                      aria-current={!q && active === s.id ? "page" : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition ${!q && active === s.id ? "bg-accent text-white" : "text-fg/90 hover:bg-hover"}`}
                    >
                      <s.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{s.label}</span>
                      {e > 0 ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-[var(--err)]" aria-label={`${e} problems`} />
                      ) : n > 0 ? (
                        <span className="h-2 w-2 rounded-full bg-[var(--warn)]" aria-label={`${n} unsaved`} />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex min-w-0 flex-col gap-6">
            {visible.map(({ section, fields }) => (
              <section key={section.id} className="glass flex flex-col gap-5 rounded-3xl p-5 sm:p-6" aria-labelledby={`s-${section.id}`}>
                <header>
                  <h2 id={`s-${section.id}`} className="flex items-center gap-2 text-lg font-semibold">
                    <section.icon className="h-5 w-5 text-accent" /> {section.label}
                  </h2>
                  <p className="text-sm text-muted">{section.description}</p>
                </header>
                {!q && section.extra === "looks" && (
                  <LookPicker
                    draft={draft}
                    onApply={(look) =>
                      setDraft((cur) => {
                        let next = look.theme ? setPath(cur, "theme", look.theme) : cur;
                        next = setPath(next, "style", look.style);
                        next = setPath(next, "background.gradient", look.gradient);
                        next = setPath(next, "accent", look.accent);
                        return setPath(next, "glow", look.glow);
                      })
                    }
                  />
                )}
                {fields.length > 0 && <div className="grid max-w-2xl gap-5">{fields.map(field)}</div>}
                {!q && section.extra === "testAlert" && <TestAlertButton />}
                {!q && section.extra === "updates" && <UpdatesPanel />}
                {!q && section.extra === "users" && (
                  <div className="flex flex-col gap-3 border-t border-line pt-5">
                    <h3 className="text-sm font-semibold tracking-wider text-muted uppercase">Accounts</h3>
                    <UsersPanel />
                    <div className="mt-4">
                      <GroupsPanel />
                    </div>
                    <div className="mt-4">
                      <AuditPanel />
                    </div>
                  </div>
                )}
                {!q && section.extra === "backup" && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <a href="/api/config/export" download className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
                        <Download className="h-4 w-4" /> Download config (.zip)
                      </a>
                      <button type="button" onClick={() => setImporting(true)} className="flex items-center gap-1.5 rounded-full bg-track px-4 py-2 text-sm hover:bg-hover">
                        <FileUp className="h-4 w-4" /> Import from Homepage
                      </button>
                    </div>
                    <p className="text-xs text-muted">The download contains the files as they are on disk, including secrets that are not in env vars.</p>
                    <HistoryPanel
                      onRestored={() => {
                        void reload();
                        router.refresh();
                      }}
                    />
                  </>
                )}
              </section>
            ))}
            {q && !visible.length && <p className="py-16 text-center text-muted">No setting matches “{query}”.</p>}
          </div>
        </div>
      </main>

      {(dirty || errorCount > 0) && (
        <div role="region" aria-label="Unsaved changes" className="glass fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm">
          <span className="mr-auto">
            {errorCount > 0 ? (
              <span className="text-[var(--err)]">
                {errorCount} {errorCount === 1 ? "problem" : "problems"} to fix
              </span>
            ) : (
              <>
                {changed.length} unsaved {changed.length === 1 ? "change" : "changes"}
              </>
            )}
          </span>
          <button type="button" onClick={discard} className="rounded-full px-3 py-1.5 hover:bg-hover">
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || errorCount > 0 || !dirty}
            className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> Save
          </button>
        </div>
      )}

      {toast && (
        <div role="status" className={`glass fixed top-4 right-4 z-50 rounded-2xl px-4 py-3 text-sm ${toast.error ? "text-[var(--err)]" : ""}`}>
          {toast.message}
        </div>
      )}

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            void reload();
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function applyTheme(root: HTMLElement, theme: string) {
  const a = themeAttrs(theme);
  root.dataset.theme = a.theme;
  if (a.tone) root.dataset.tone = a.tone;
  else delete root.dataset.tone;
}

const styleNotes: Record<(typeof stylePresets)[number], string> = {
  glass: "Frosted",
  liquid: "Liquid glass",
  aero: "Frutiger Aero",
  neon: "Glowing edges",
  brutal: "Bold & flat",
  soft: "Neumorphic",
  retro: "Windows 98",
  minimal: "Light touch",
  solid: "Opaque",
};

/** Each option is drawn with its own style tokens (data-style scopes the CSS variables). */
function StylePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-muted">Card style</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stylePresets.map((s) => (
          <label key={s} data-style={s} className="cursor-pointer">
            <input type="radio" name="style" value={s} checked={value === s} onChange={() => onChange(s)} className="peer sr-only" />
            <div className="glass flex h-20 flex-col justify-end rounded-2xl p-3 transition peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
              <span className="text-sm font-semibold capitalize">{s}</span>
              <span className="text-xs text-muted">{styleNotes[s]}</span>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function GradientPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-medium text-muted">Gradient</legend>
      <div className="flex flex-wrap gap-3">
        {gradientPresets.map((g) => {
          const c = gradientColors[g];
          const bg: CSSProperties = {
            background: c.swatch ?? `radial-gradient(circle at 20% 25%, ${c.blobs[0]} 0, transparent 55%), radial-gradient(circle at 85% 80%, ${c.blobs[1]} 0, transparent 55%), radial-gradient(circle at 50% 50%, ${c.blobs[2]} 0, transparent 60%), ${c.base}`,
          };
          return (
            <label key={g} className="flex cursor-pointer flex-col items-center gap-1.5 text-xs">
              <input type="radio" name="gradient" value={g} checked={value === g} onChange={() => onChange(g)} className="peer sr-only" />
              <span className="h-14 w-20 rounded-xl ring-1 ring-line transition peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent" style={bg} />
              <span className="capitalize">{g}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** One-click looks: style, background, accent and glow together (still only a draft until saved). */
function LookPicker({ draft, onApply }: { draft: Obj; onApply: (look: LookPreset) => void }) {
  const current = (l: LookPreset) =>
    getPath(draft, "style") === l.style &&
    (getPath(draft, "background.gradient") ?? "aurora") === l.gradient &&
    getPath(draft, "accent") === l.accent &&
    (!l.theme || getPath(draft, "theme") === l.theme);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">Looks</span>
      <div className="flex flex-wrap gap-2">
        {lookPresets.map((l) => {
          const c = gradientColors[l.gradient];
          return (
            <button
              key={l.id}
              type="button"
              data-look={l.id}
              aria-pressed={current(l)}
              onClick={() => onApply(l)}
              className="flex items-center gap-2 rounded-full bg-track py-1 pr-4 pl-1 text-sm transition hover:bg-hover aria-pressed:ring-2 aria-pressed:ring-accent"
            >
              <span
                aria-hidden
                className="h-7 w-7 rounded-full ring-1 ring-line"
                style={{ background: c.swatch ?? `radial-gradient(circle at 30% 30%, ${c.blobs[1]}, ${c.blobs[0]} 60%, ${c.base})` }}
              />
              {l.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
