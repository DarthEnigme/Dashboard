"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { motion } from "framer-motion";
import { ArrowLeft, BookOpen, Clapperboard, Gamepad2, Plus, Search, Shapes, Star, Tv } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { BookHit, WatchItem, WatchKind, WatchStats, WatchStatus } from "@/lib/watchlist/store";
import { msg } from "@/i18n";
import { dateOnly, number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Dialog } from "../edit/Dialog";
import { DeleteButton } from "../edit/controls";
import { inputBase, inputClass } from "../edit/FieldInput";

interface Data {
  items: WatchItem[];
  stats: WatchStats;
}

const KEY = "/api/watchlist";
const STATUSES: WatchStatus[] = ["active", "planned", "done", "dropped"];
const STATUS_LABELS: Record<WatchStatus, string> = { active: msg("In progress"), planned: msg("Planned"), done: msg("Finished"), dropped: msg("Dropped") };
const KINDS: WatchKind[] = ["book", "movie", "show", "game", "other"];
const KIND_LABELS: Record<WatchKind, string> = { book: msg("Books"), movie: msg("Movies"), show: msg("Shows"), game: msg("Games"), other: msg("Other") };
const KIND_ONE: Record<WatchKind, string> = { book: msg("Book"), movie: msg("Movie"), show: msg("TV show"), game: msg("Game"), other: msg("Other") };
const KIND_ICON = { book: BookOpen, movie: Clapperboard, show: Tv, game: Gamepad2, other: Shapes } as const;
/** What progress counts, per kind. */
const UNIT: Record<WatchKind, [string, string]> = {
  book: [msg("{n} page"), msg("{n} pages")],
  show: [msg("{n} episode"), msg("{n} episodes")],
  movie: [msg("{n} min"), msg("{n} min")],
  game: [msg("{n} hour"), msg("{n} hours")],
  other: [msg("{n} step"), msg("{n} steps")],
};

/** Books, movies, shows and games to get to: what you're on, what's next, what you finished. */
export function WatchlistPage() {
  const t = useT();
  const { data, mutate, error } = useSWR<Data>(KEY, fetcher);
  const [status, setStatus] = useState<WatchStatus>("active");
  const [kind, setKind] = useState<WatchKind | "all">("all");
  const [open, setOpen] = useState<WatchItem>();
  const items = data?.items ?? [];
  const shown = items.filter((i) => i.status === status && (kind === "all" || i.kind === kind));
  const save = (d: Data) => mutate(d, { revalidate: false });

  // Start on the first status that has something in it.
  useEffect(() => {
    if (!data || data.items.some((i) => i.status === status)) return;
    const first = STATUSES.find((s) => data.items.some((i) => i.status === s));
    if (first) setStatus(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data === undefined]);

  const s = data?.stats;
  const finished = s ? KINDS.filter((k) => s.done[k]).map((k) => `${s.done[k]} ${t(KIND_LABELS[k]).toLowerCase()}`) : [];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {t("Dashboard")}
      </Link>
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t("Watchlist")}</h1>
        <p className="text-muted">{t("Books, movies, shows and games: what you're on, what's next and what you finished.")}</p>
      </header>
      {error && <p className="text-[var(--err)]">{(error as Error).message}</p>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={t("Watchlist stats")}>
        <Stat label={t("In progress")} value={String(s?.active ?? "–")} />
        <Stat label={t("Planned")} value={String(s?.planned ?? "–")} />
        <Stat label={t("Finished in {year}", { year: s?.year ?? "" })} value={String(KINDS.reduce((a, k) => a + (s?.done[k] ?? 0), 0))} note={finished.join(" · ") || undefined} />
        <Stat label={t("Pages read in {year}", { year: s?.year ?? "" })} value={s ? number(s.pages) : "–"} />
      </section>

      <AddBar onAdded={save} />

      <div className="flex flex-wrap items-center gap-2">
        <nav className="glass flex w-fit flex-wrap gap-1 rounded-full p-1 text-sm" role="tablist" aria-label={t("Watchlist sections")}>
          {STATUSES.map((st) => {
            const n = items.filter((i) => i.status === st).length;
            return (
              <button key={st} type="button" role="tab" aria-selected={status === st} onClick={() => setStatus(st)} className={`relative rounded-full px-4 py-1.5 ${status === st ? "text-white" : "text-muted hover:text-fg"}`}>
                {status === st && <motion.span layoutId="watch-tab" className="tab-pill absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
                <span className="relative">
                  {t(STATUS_LABELS[st])}
                  {n > 0 && <span className="ml-1.5 text-xs opacity-70">{n}</span>}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex flex-wrap gap-1 text-sm" role="group" aria-label={t("Kind")}>
          {(["all", ...KINDS] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className="rounded-full px-3 py-1 text-muted hover:bg-hover hover:text-fg aria-pressed:bg-chip aria-pressed:text-fg">
              {k === "all" ? t("All") : t(KIND_LABELS[k])}
            </button>
          ))}
        </div>
      </div>

      {data && !shown.length && <p className="glass rounded-3xl p-8 text-center text-sm text-muted">{t("Nothing here yet.")}</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {shown.map((i) => (
          <li key={i.id}>
            <Card item={i} onOpen={() => setOpen(i)} />
          </li>
        ))}
      </ul>

      {open && <ItemDialog item={open} onClose={() => setOpen(undefined)} onSaved={save} />}
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="truncate text-xs text-muted">{note}</div>}
    </div>
  );
}

function Cover({ item, className = "" }: { item: Pick<WatchItem, "cover" | "title" | "kind">; className?: string }) {
  const [broken, setBroken] = useState(false);
  const Icon = KIND_ICON[item.kind];
  if (item.cover && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.cover} alt="" loading="lazy" onError={() => setBroken(true)} className={`aspect-[2/3] w-full rounded-xl object-cover ring-1 ring-line ${className}`} />;
  }
  return (
    <div aria-hidden className={`grid aspect-[2/3] w-full place-items-center rounded-xl bg-gradient-to-br from-accent/40 to-chip p-3 text-center ring-1 ring-line ${className}`}>
      <Icon className="h-7 w-7 text-fg/70" />
      <span className="line-clamp-3 text-xs font-semibold text-fg/90">{item.title}</span>
    </div>
  );
}

function Card({ item, onOpen }: { item: WatchItem; onOpen: () => void }) {
  const t = useT();
  const pct = item.total && item.progress ? Math.min(100, Math.round((item.progress / item.total) * 100)) : null;
  return (
    <button type="button" onClick={onOpen} className="group flex w-full flex-col gap-1.5 text-left" data-watch={item.title}>
      <div className="relative transition group-hover:-translate-y-0.5">
        <Cover item={item} />
        {item.status === "active" && pct !== null && (
          <div className="absolute inset-x-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-black/40" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("{name} progress", { name: item.title })}>
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
      <span className="truncate text-xs text-muted">{[item.creator, item.year].filter(Boolean).join(" · ") || t(KIND_ONE[item.kind])}</span>
      {item.rating && (
        <span className="flex" aria-label={t("{n} of 5", { n: item.rating })}>
          {Array.from({ length: item.rating }, (_, i) => (
            <Star key={i} className="h-3 w-3 fill-[var(--warn)] text-[var(--warn)]" />
          ))}
        </span>
      )}
    </button>
  );
}

function AddBar({ onAdded }: { onAdded: (d: Data) => void }) {
  const t = useT();
  const [kind, setKind] = useState<WatchKind>("book");
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [hits, setHits] = useState<BookHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();

  // Books: look them up on Open Library as you type.
  useEffect(() => {
    if (kind !== "book" || title.trim().length < 3) return setHits([]);
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        setHits(await fetcher<BookHit[]>(`/api/watchlist/books?q=${encodeURIComponent(title.trim())}`));
        setError(undefined);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [title, kind]);

  const add = async (b: Record<string, unknown>) => {
    try {
      onAdded(await sendJson<Data>(KEY, "POST", { kind, ...b }));
      setTitle("");
      setCreator("");
      setHits([]);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) void add({ title, creator });
      }}
      className="glass relative flex flex-col gap-2 rounded-2xl p-3"
      aria-label={t("Add to the watchlist")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={t("Kind")} value={kind} onChange={(e) => setKind(e.target.value as WatchKind)} className={`${inputBase} w-32`}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(KIND_ONE[k])}
            </option>
          ))}
        </select>
        <label className="relative min-w-48 flex-1">
          {kind === "book" && <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "book" ? t("Search a book, or type a title…") : t("Title")}
            aria-label={t("Title")}
            className={`${inputClass} ${kind === "book" ? "pl-9" : ""}`}
          />
        </label>
        <input value={creator} onChange={(e) => setCreator(e.target.value)} placeholder={kind === "book" ? t("Author") : kind === "game" ? t("Studio") : t("Director, creator…")} aria-label={t("By")} className={`${inputBase} w-44`} />
        <button type="submit" className="flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("Add")}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--err)]">{error}</p>}
      {kind === "book" && (hits.length > 0 || searching) && (
        <ul role="listbox" aria-label={t("Books found")} className="grid gap-1 sm:grid-cols-2">
          {searching && !hits.length && <li className="px-2 py-1 text-sm text-muted">{t("Searching…")}</li>}
          {hits.map((h) => (
            <li key={h.key}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => void add({ title: h.title, creator: h.author, year: h.year, cover: h.cover, total: h.pages, external_id: h.key })}
                className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left hover:bg-hover"
              >
                <div className="w-9 shrink-0">
                  <Cover item={{ cover: h.cover, title: h.title, kind: "book" }} className="rounded-md" />
                </div>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{h.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {[h.author, h.year, h.pages ? t("{n} pages", { n: h.pages }) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function ItemDialog({ item, onClose, onSaved }: { item: WatchItem; onClose: () => void; onSaved: (d: Data) => void }) {
  const t = useT();
  const [v, setV] = useState({ ...item });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof WatchItem>(k: K, value: WatchItem[K]) => setV((cur) => ({ ...cur, [k]: value }));
  const [one, many] = UNIT[v.kind];

  const submit = async () => {
    setBusy(true);
    try {
      onSaved(await sendJson<Data>(KEY, "PATCH", v));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={item.title} onClose={onClose} onSubmit={() => void submit()} error={error} busy={busy}>
      <div className="flex gap-4">
        <div className="w-24 shrink-0">
          <Cover item={v} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            {t("Title")}
            <input value={v.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            {t("By")}
            <input value={v.creator ?? ""} onChange={(e) => set("creator", e.target.value || null)} className={inputClass} />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Status")}>
        {STATUSES.map((st) => (
          <button key={st} type="button" role="radio" aria-checked={v.status === st} onClick={() => set("status", st)} className="rounded-full bg-chip px-3 py-1 text-xs hover:bg-hover aria-checked:bg-accent aria-checked:text-white">
            {t(STATUS_LABELS[st])}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {t("Progress")}
          <input type="number" min={0} value={v.progress ?? ""} onChange={(e) => set("progress", e.target.value === "" ? null : Number(e.target.value))} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {t("Out of")}
          <input type="number" min={1} value={v.total ?? ""} onChange={(e) => set("total", e.target.value === "" ? null : Number(e.target.value))} className={inputClass} />
        </label>
      </div>
      {v.total && <p className="-mt-2 text-xs text-muted">{t.plural(v.progress ?? 0, one, many)} / {t.plural(v.total, one, many)}</p>}
      <div className="flex items-center gap-1" role="radiogroup" aria-label={t("Rating")}>
        <span className="mr-2 text-xs font-medium text-muted">{t("Rating")}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={v.rating === n} aria-label={t("{n} of 5", { n })} onClick={() => set("rating", v.rating === n ? null : n)} className="p-0.5">
            <Star className={`h-5 w-5 ${v.rating && n <= v.rating ? "fill-[var(--warn)] text-[var(--warn)]" : "text-muted"}`} />
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        {t("Notes")}
        <textarea value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} rows={3} className={`${inputClass} h-auto py-2`} />
      </label>
      <p className="text-xs text-muted">
        {[v.started && t("Started {date}", { date: dateOnly(v.started) }), v.finished && t("Finished {date}", { date: dateOnly(v.finished) })].filter(Boolean).join(" · ")}
      </p>
      <div className="flex justify-end">
        <DeleteButton
          label={t("Delete {name}", { name: item.title })}
          onConfirm={async () => {
            onSaved(await sendJson<Data>(`${KEY}?id=${item.id}`, "DELETE"));
            onClose();
          }}
        />
      </div>
    </Dialog>
  );
}
