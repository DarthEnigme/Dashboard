"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  Bookmark,
  Command,
  CornerDownLeft,
  ExternalLink,
  Info,
  LayoutGrid,
  Loader2,
  Palette,
  Pencil,
  Power,
  Search,
  Settings2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { scoreItem } from "@/lib/fuzzy";
import { listTabs } from "@/lib/tabs";
import { glowLevels, stylePresets, themes } from "@/lib/config/schema";
import type { ClientConfig, ClientService } from "@/lib/config/sanitize";
import type { ClientAuth } from "@/lib/auth";
import type { ServiceAction } from "@/integrations/types";
import { sections } from "../settings/sections";

export interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  icon: LucideIcon;
  /** Extra words to match on. */
  keywords?: string;
  /** Enter. */
  run: () => void | Promise<void>;
  /** Shift+Enter, e.g. a service's details page instead of its link. */
  alt?: { label: string; run: () => void };
  /** Keep the palette open after running (opens a sub-list). */
  stay?: boolean;
}

type Mode = { kind: "root" } | { kind: "actions"; service: ClientService } | { kind: "confirm"; service: ClientService; action: ServiceAction };

const RECENT_KEY = "page.palette.recent";
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};
const pushRecent = (id: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((r) => r !== id)].slice(0, 6)));
  } catch {
    // private mode: no recents
  }
};

/** Write one top-level settings key, keeping the rest of settings.yaml (and its comments) as is. */
async function setSetting(key: string, value: string) {
  const raw = await fetcher<{ settings: Record<string, unknown> }>("/api/config?raw=1");
  await sendJson("/api/config", "PUT", { file: "settings", data: { ...raw.settings, [key]: value } });
}

/**
 * Ctrl/⌘+K: jump to any service, bookmark, tab, page or setting, run container/VM actions and a
 * few commands. Everything the viewer may not see is already filtered out by /api/config.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: config } = useSWR<ClientConfig>("/api/config", fetcher);
  const { data: auth } = useSWR<ClientAuth>("/api/auth", fetcher);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "root" });
  const [status, setStatus] = useState<{ text: string; error?: boolean; busy?: boolean }>();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const recent = useMemo(readRecent, []);

  const isAdmin = auth?.user?.role === "admin";
  const target = config?.settings.target ?? "_blank";
  const onDashboard = !!config && !/^\/(finance|settings|service|login|setup)\b/.test(pathname);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const rootItems = useMemo<PaletteItem[]>(() => {
    if (!config) return [];
    const items: PaletteItem[] = [];
    const tabs = listTabs(config.settings.tabs, config.services);
    for (const g of config.services) {
      for (const s of g.services) {
        const details = { label: "Details", run: () => go(`/service/${encodeURIComponent(s.id)}`) };
        items.push({
          id: `svc:${s.id}`,
          title: s.name,
          subtitle: [g.name, s.description].filter(Boolean).join(" · "),
          group: "Services",
          icon: s.href ? ExternalLink : Info,
          keywords: `${g.name} ${s.widget ?? ""}`,
          run: s.href
            ? () => {
                onClose();
                window.open(s.href, target);
              }
            : details.run,
          alt: details,
        });
        if (isAdmin && s.actions) {
          items.push({
            id: `act:${s.id}`,
            title: `Actions for ${s.name}…`,
            subtitle: "Start, stop, restart",
            group: "Actions",
            icon: Power,
            keywords: `${s.widget ?? ""} restart start stop reboot`,
            stay: true,
            run: () => {
              setMode({ kind: "actions", service: s });
              setQuery("");
            },
          });
        }
      }
    }
    for (const g of config.bookmarks) {
      for (const l of g.links) {
        items.push({
          id: `bm:${g.name}:${l.name}`,
          title: l.name,
          subtitle: g.name,
          group: "Bookmarks",
          icon: Bookmark,
          keywords: l.description,
          run: () => {
            onClose();
            window.open(l.href, target);
          },
        });
      }
    }
    if (tabs.length > 1) {
      for (const t of tabs) items.push({ id: `tab:${t.slug}`, title: t.name, subtitle: "Tab", group: "Go to", icon: LayoutGrid, run: () => go(`/${t.slug}`) });
    }
    if (pathname !== "/" || tabs.length < 2) items.push({ id: "page:/", title: "Dashboard", group: "Go to", icon: LayoutGrid, run: () => go("/") });
    if (auth?.user) items.push({ id: "page:/finance", title: "Finance", group: "Go to", icon: Wallet, keywords: "money budget spending", run: () => go("/finance") });
    if (auth?.canEdit) {
      for (const sec of sections) {
        items.push({
          id: `set:${sec.id}`,
          title: `Settings: ${sec.label}`,
          subtitle: sec.description,
          group: "Settings",
          icon: sec.icon ?? Settings2,
          keywords: sec.fields.map((f) => f.label).join(" "),
          run: () => go(`/settings#${sec.id}`),
        });
      }
      if (isAdmin) {
        items.push({
          id: "cmd:updates",
          title: "Check for updates",
          group: "Commands",
          icon: Settings2,
          keywords: "update upgrade version release",
          run: () => go("/settings#updates"),
        });
      }
      items.push({
        id: "cmd:edit",
        title: "Edit dashboard",
        group: "Commands",
        icon: Pencil,
        keywords: "editor add service",
        run: () => {
          onClose();
          if (onDashboard) window.dispatchEvent(new Event("page:edit"));
          else window.location.href = "/#edit";
        },
      });
      const command = (id: string, title: string, key: string, value: string, icon: LucideIcon): PaletteItem => ({
        id,
        title,
        group: "Commands",
        icon,
        keywords: `${key} appearance`,
        stay: true,
        run: async () => {
          setStatus({ text: `${title}…`, busy: true });
          try {
            await setSetting(key, value);
            setStatus({ text: `${title}: saved` });
            router.refresh();
            setTimeout(onClose, 700);
          } catch (e) {
            setStatus({ text: (e as Error).message, error: true });
          }
        },
      });
      for (const t of themes) if (config.settings.theme !== t) items.push(command(`cmd:theme:${t}`, `Theme: ${t}`, "theme", t, Palette));
      for (const s of stylePresets) if (config.settings.style !== s) items.push(command(`cmd:style:${s}`, `Card style: ${s}`, "style", s, Palette));
      for (const g of glowLevels) if (config.settings.glow !== g) items.push(command(`cmd:glow:${g}`, `Hover glow: ${g}`, "glow", g, Palette));
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, auth, pathname, isAdmin, target, onDashboard]);

  // Live action list for one service.
  const service = mode.kind === "root" ? undefined : mode.service;
  const { data: actions, error: actionsError } = useSWR<ServiceAction[]>(
    mode.kind === "actions" ? `/api/actions/${encodeURIComponent(mode.service.id)}` : null,
    fetcher,
  );
  const actionItems = useMemo<PaletteItem[]>(
    () =>
      (actions ?? []).map((a) => ({
        id: `${a.target ?? ""}|${a.id}`,
        title: a.targetLabel ? `${a.label} ${a.targetLabel}` : a.label,
        group: a.targetLabel ? "Guests" : "Service",
        icon: Power,
        stay: true,
        run: () => service && setMode({ kind: "confirm", service, action: a }),
      })),
    [actions, service],
  );

  const shown = useMemo(() => {
    const source = mode.kind === "actions" ? actionItems : mode.kind === "root" ? rootItems : [];
    if (!query.trim()) {
      if (mode.kind !== "root") return source;
      const recents = recent.flatMap((id) => source.filter((i) => i.id === id)).map((i) => ({ ...i, group: "Recent" }));
      // Browsing shows places; actions, settings and commands appear once you type.
      const rest = source.filter((i) => !recent.includes(i.id) && !["Actions", "Commands", "Settings"].includes(i.group));
      return [...recents, ...rest].slice(0, 60);
    }
    return source
      .map((i) => ({ i, s: scoreItem(query, i.title, i.subtitle, i.keywords, i.group) }))
      .filter((x): x is { i: PaletteItem; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.i);
  }, [mode.kind, actionItems, rootItems, query, recent]);

  useEffect(() => setActive(0), [query, mode]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Focus the input, restore focus on close, and lock page scroll while open.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  const runAction = async () => {
    if (mode.kind !== "confirm") return;
    const { service: s, action: a } = mode;
    setStatus({ text: `${a.label}…`, busy: true });
    try {
      const r = await sendJson<{ message: string }>(`/api/actions/${encodeURIComponent(s.id)}`, "POST", { action: a.id, target: a.target });
      setStatus({ text: r.message });
      setTimeout(onClose, 1200);
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
    }
  };

  const choose = (item: PaletteItem | undefined, alt = false) => {
    if (!item) return;
    if (mode.kind === "root") pushRecent(item.id);
    if (alt && item.alt) item.alt.run();
    else void item.run();
  };

  const back = () => {
    setStatus(undefined);
    if (mode.kind === "confirm") setMode({ kind: "actions", service: mode.service });
    else if (mode.kind === "actions") setMode({ kind: "root" });
    else onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      back();
    } else if (e.key === "Tab") {
      e.preventDefault(); // the input is the only stop: keep focus inside
    } else if (mode.kind === "confirm") {
      if (e.key === "Enter") {
        e.preventDefault();
        void runAction();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(shown[active], e.shiftKey);
    } else if (e.key === "Backspace" && !query && mode.kind !== "root") {
      back();
    }
  };

  const optionId = (i: number) => `palette-opt-${i}`;
  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[var(--scrim)] px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="glass glass-lens flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl" style={{ background: "var(--dialog)" }}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          {mode.kind === "root" ? (
            <Search className="h-4 w-4 shrink-0 text-muted" />
          ) : (
            <button type="button" tabIndex={-1} onClick={back} aria-label="Back" className="-ml-1 rounded-full p-1 text-muted hover:bg-hover hover:text-fg">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {mode.kind !== "root" && <span className="shrink-0 rounded-full bg-track px-2 py-0.5 text-xs">{mode.service.name}</span>}
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={mode.kind === "root" ? "Search services, pages, settings, commands…" : mode.kind === "actions" ? "Filter actions…" : "Press Enter to confirm, Esc to go back"}
            readOnly={mode.kind === "confirm"}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown.length && mode.kind !== "confirm" ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label="Command"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded-md border border-line px-1.5 text-[11px] text-muted sm:block">Esc</kbd>
        </div>

        {mode.kind === "confirm" ? (
          <div className="flex flex-col gap-3 p-5">
            <p className="text-sm">
              <span className={mode.action.danger ? "font-semibold text-[var(--err)]" : "font-semibold"}>
                {mode.action.label} {mode.action.targetLabel ?? mode.service.name}?
              </span>{" "}
              <span className="text-muted">
                {mode.action.danger ? "This cuts power without a clean shutdown and can lose unsaved data." : "This happens right away."}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => void runAction()}
                disabled={status?.busy}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium text-white ${mode.action.danger ? "bg-[var(--err)]" : "bg-accent"}`}
              >
                <CornerDownLeft className="h-3.5 w-3.5" /> {mode.action.label}
              </button>
              <button type="button" tabIndex={-1} onClick={back} className="rounded-full px-3 py-1.5 text-sm hover:bg-hover">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <ul ref={list} id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
            {!config && <Note><Loader2 className="h-4 w-4 animate-spin" /> Loading…</Note>}
            {mode.kind === "actions" && !actions && !actionsError && <Note><Loader2 className="h-4 w-4 animate-spin" /> Loading actions…</Note>}
            {actionsError && <Note error>{(actionsError as Error).message}</Note>}
            {config && shown.length === 0 && (mode.kind === "root" || actions) && <Note>Nothing matches “{query}”.</Note>}
            {shown.map((item, i) => {
              const heading = !query.trim() && item.group !== lastGroup ? item.group : undefined;
              lastGroup = item.group;
              const Icon = item.icon;
              return (
                <li key={`${item.group}:${item.id}`} role="presentation">
                  {heading && <div className="px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{heading}</div>}
                  <div
                    id={optionId(i)}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={(e) => choose(item, e.shiftKey)}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm ${i === active ? "bg-hover" : ""}`}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.title}</span>
                      {item.subtitle && <span className="block truncate text-xs text-muted">{item.subtitle}</span>}
                    </span>
                    {query.trim() && <span className="shrink-0 text-[11px] text-muted">{item.group}</span>}
                    {i === active && item.alt && <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 text-[10px] text-muted sm:block">⇧↵ {item.alt.label}</kbd>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted" role={status ? "status" : undefined}>
          {status ? (
            <span className={`flex items-center gap-1.5 ${status.error ? "text-[var(--err)]" : ""}`}>
              {status.busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {status.text}
            </span>
          ) : (
            <>
              <span>↑↓ move</span>
              <span>↵ open</span>
              <span className="hidden sm:inline">⇧↵ details</span>
              <span>Esc {mode.kind === "root" ? "close" : "back"}</span>
              <span className="ml-auto flex items-center gap-1">
                <Command className="h-3 w-3" /> K
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Note({ children, error }: { children: ReactNode; error?: boolean }) {
  return <li className={`flex items-center justify-center gap-2 px-3 py-6 text-sm ${error ? "text-[var(--err)]" : "text-muted"}`}>{children}</li>;
}
