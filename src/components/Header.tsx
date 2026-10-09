"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Command, Pencil, Search, Settings, X } from "lucide-react";
import type { AppSection } from "@/lib/sections";
import { AppsMenu } from "./AppsMenu";
import { useT } from "@/i18n/client";

interface Props {
  title: string;
  /** settings.logo: shown before the title. */
  logo?: string;
  description?: string;
  query: string;
  onQuery: (q: string) => void;
  onSubmit: () => void;
  onEdit?: () => void;
  /** Admins: a gear button linking to the settings page. */
  showSettings?: boolean;
  /** Admins: a newer version of Page is available (dot on the gear). */
  updateAvailable?: string;
  /** Sections this person may open (Finance, Travel…): a button, or an Apps menu for several. */
  sections?: AppSection[];
  /** Monitoring button (opens the slide-out panel). */
  monitor?: ReactNode;
  /** User menu or sign-in link, after the edit button. */
  account?: ReactNode;
}

export function Header({ title, logo, description, query, onQuery, onSubmit, onEdit, showSettings, updateAvailable, sections = [], monitor, account }: Props) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      // Ctrl/⌘+K opens the command palette (PaletteLauncher); "/" focuses this filter.
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="relative z-30 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-contain sm:h-14 sm:w-14" />
        )}
        <div className="min-w-0">
          <h1 className="bg-gradient-to-r from-fg to-fg/60 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
            {title}
          </h1>
          {description && <p className="mt-1 text-muted">{description}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <form
          role="search"
          className="glass glass-lens flex h-11 w-full items-center gap-2 rounded-full px-4 transition focus-within:ring-2 focus-within:ring-accent/60 sm:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={input}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onQuery("")}
            placeholder={t("Filter services…")}
            aria-label={t("Filter services and bookmarks")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          {query ? (
            <button type="button" onClick={() => onQuery("")} aria-label={t("Clear filter")} className="text-muted hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden rounded-md border border-line px-1.5 text-[11px] text-muted sm:block">/</kbd>
          )}
        </form>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("page:palette"))}
          className="glass glass-interactive hidden h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs text-muted sm:flex"
          aria-label={t("Open command palette")}
          title={t("Command palette (Ctrl+K)")}
        >
          <Command className="h-3.5 w-3.5" /> K
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            className="glass glass-interactive grid h-11 w-11 shrink-0 place-items-center rounded-full"
            aria-label={t("Edit dashboard")}
            title={t("Edit dashboard")}
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {monitor}
        <AppsMenu sections={sections} />
        {showSettings && (
          <Link
            href={updateAvailable ? "/settings#updates" : "/settings"}
            className="glass glass-interactive grid h-11 w-11 shrink-0 place-items-center rounded-full"
            aria-label={updateAvailable ? t("Settings (update {version} available)", { version: updateAvailable }) : t("Settings")}
            title={updateAvailable ? t("Page {version} is available", { version: updateAvailable }) : t("Settings")}
          >
            <Settings className="h-4 w-4" />
            {updateAvailable && <span aria-hidden className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-[var(--page)]" />}
          </Link>
        )}
        {account}
      </div>
    </header>
  );
}
