"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Bell, BellOff, NotebookText, Wrench, X } from "lucide-react";
import Link from "next/link";
import { runbookKey, type RunbookAnswer } from "./notes/Runbook";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Maintenance, MaintenanceWindow, Mutes } from "@/lib/maintenance";
import { formatLocale } from "@/i18n/format";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";

const KEY = "/api/maintenance";
const ALL = "*";
type State = { mutes: Mutes; maintenance: Maintenance[]; windows: (MaintenanceWindow & { active: boolean })[] };

const MUTE_CHOICES: { label: string; minutes: number | null }[] = [
  { label: msg("30 minutes"), minutes: 30 },
  { label: msg("2 hours"), minutes: 120 },
  { label: msg("8 hours"), minutes: 480 },
  { label: msg("Until I turn them back on"), minutes: null },
];
const MAINT_CHOICES: { label: string; minutes: number | null }[] = [
  { label: msg("30 minutes"), minutes: 30 },
  { label: msg("2 hours"), minutes: 120 },
  { label: msg("8 hours"), minutes: 480 },
  { label: msg("Until I end it"), minutes: null },
];

const clock = (t: number) => new Date(t).toLocaleString(formatLocale(), { weekday: "short", hour: "2-digit", minute: "2-digit" });
const field = "w-full rounded-lg bg-chip px-2.5 py-1.5 text-sm outline-none placeholder:text-muted focus:ring-2 focus:ring-accent";
const item = "flex w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-hover";

/** Close an open menu on Escape or a click outside it. */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", handler);
    };
  }, [open, ref, close]);
}

/** Write a change, then refresh what shows the bell and wrench markers (tiles, monitoring panel). */
function useApply() {
  const { mutate } = useSWRConfig();
  return async (next: Promise<unknown>) => {
    await mutate(KEY, next, { revalidate: false });
    await mutate((key) => typeof key === "string" && (key.startsWith("/api/ping") || key === "/api/status" || key === "/api/tiles"));
  };
}

const buttonClass = (compact: boolean | undefined, on: boolean, tone: string) =>
  compact
    ? `grid h-8 w-8 place-items-center rounded-full hover:bg-hover ${on ? `text-[var(${tone})]` : "text-muted hover:text-fg"}`
    : `flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium ${on ? `bg-[color-mix(in_oklab,var(${tone})_18%,transparent)] text-[var(${tone})]` : "bg-chip text-muted hover:text-fg"}`;

/**
 * Admins: mute the notifications of one service (`target` is its id) or of everything ("*").
 * Only alerts are held back: checks, uptime and the status page carry on as usual. For planned
 * work, use maintenance instead. `name` is what the button's label calls the target.
 */
export function MuteButton({ target, name, compact }: { target: string; name: string; compact?: boolean }) {
  const t = useT();
  const apply = useApply();
  const { data } = useSWR<State>(KEY, fetcher, { refreshInterval: 60_000 });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  // A mute of everything covers this service too; turning it back on here ends that one.
  const own = data?.mutes[target];
  const all = !own && target !== ALL ? data?.mutes[ALL] : undefined;
  const m = own ?? all;
  const muted = m ? (all ? ALL : target) : null;

  const done = (next: Promise<unknown>) => {
    setOpen(false);
    setNote("");
    return apply(next);
  };
  const muteFor = (minutes: number | null) => done(sendJson(KEY, "POST", { kind: "mute", service: target, minutes, note }));
  const unmute = () => done(sendJson(`${KEY}?service=${encodeURIComponent(muted!)}`, "DELETE"));

  const label = m
    ? `${
        all
          ? t("All alerts are muted. Turn them back on")
          : m.until === null
            ? t("Alerts for {name} are muted. Turn them back on", { name })
            : t("Alerts for {name} are muted until {time}. Turn them back on", { name, time: clock(m.until) })
      }${m.note ? ` (${m.note})` : ""}`
    : t("Mute alerts for {name}", { name });

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (m ? unmute() : setOpen((o) => !o))}
        aria-label={label}
        title={label}
        aria-haspopup={m ? undefined : "menu"}
        aria-expanded={m ? undefined : open}
        className={buttonClass(compact, !!m, "--warn")}
      >
        {m ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {!compact && (m ? (m.until === null ? t("Muted") : t("Muted until {time}", { time: clock(m.until) })) : t("Mute alerts"))}
      </button>
      {open && (
        <div role="menu" aria-label={t("Mute alerts for")} className="glass glass-lens absolute right-0 z-50 mt-2 w-64 rounded-2xl p-1.5" style={{ background: "var(--dialog)" }}>
          <p className="px-3 pt-1.5 text-xs text-muted">{t("Only notifications stop. Outages still show and count; for planned work, use maintenance.")}</p>
          <div className="px-1.5 pt-2 pb-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} aria-label={t("Note for admins (optional)")} placeholder={t("Note for admins (optional)")} className={field} />
          </div>
          <div className="px-3 py-1.5 text-xs text-muted">{t("Mute alerts for")}</div>
          {MUTE_CHOICES.map((c) => (
            <button key={c.label} type="button" role="menuitem" onClick={() => muteFor(c.minutes)} className={item}>
              {t(c.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "YYYY-MM-DDTHH:MM" in local time, for datetime-local inputs. */
const localInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

/**
 * Admins: put one service (or everything, "*") in planned maintenance, now or at a set time.
 * Alerts are held back, outages are recorded as planned and left out of uptime, and the public
 * status page shows it with the optional message. Recurring windows from settings show here too.
 */
export function MaintenanceButton({ target, name, compact }: { target: string; name: string; compact?: boolean }) {
  const t = useT();
  const apply = useApply();
  const { data } = useSWR<State>(KEY, fetcher, { refreshInterval: 60_000 });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [publicNote, setPublicNote] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  // The service's runbook, linked from the menu while it is open.
  const { data: runbook } = useSWR<RunbookAnswer>(open && target !== ALL ? runbookKey(target) : null, fetcher, { shouldRetryOnError: false });

  const now = Date.now();
  const mine = (data?.maintenance ?? []).filter((m) => m.service === target || (target !== ALL && m.service === ALL));
  const current = mine.find((m) => m.start <= now);
  const planned = mine.filter((m) => m.start > now).sort((a, b) => a.start - b.start);
  const win = data?.windows.find((w) => w.active && (!w.services?.length || w.services.includes(target) || w.services.includes(ALL)));
  const on = !!(current || win);

  const done = async (next: Promise<unknown>) => {
    setError("");
    try {
      await apply(next);
      setOpen(false);
      setNote("");
      setPublicNote("");
      setFrom("");
      setTo("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const start = (minutes: number | null) => done(sendJson(KEY, "POST", { kind: "maintenance", service: target, minutes, note, publicNote }));
  const schedule = () =>
    done(sendJson(KEY, "POST", { kind: "maintenance", service: target, start: new Date(from).getTime(), end: to ? new Date(to).getTime() : null, note, publicNote }));
  const end = (id: string) => done(sendJson(`${KEY}?maintenance=${encodeURIComponent(id)}`, "DELETE"));

  const label = current
    ? `${current.end === null ? t("{name} is in maintenance. End it", { name }) : t("{name} is in maintenance until {time}. End it", { name, time: clock(current.end) })}${current.note ? ` (${current.note})` : ""}`
    : win
      ? t("{name} is in the maintenance window {window}", { name, window: win.name ?? `${win.from}–${win.to}` })
      : t("Start maintenance for {name}", { name });

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (current ? end(current.id) : setOpen((o) => !o))}
        aria-label={label}
        title={label}
        aria-haspopup={current ? undefined : "menu"}
        aria-expanded={current ? undefined : open}
        className={buttonClass(compact, on, "--accent")}
      >
        <Wrench className="h-4 w-4" />
        {!compact && (on ? (current?.end ? t("Maintenance until {time}", { time: clock(current.end) }) : t("In maintenance")) : t("Maintenance"))}
      </button>
      {open && (
        <div role="menu" aria-label={t("Maintenance")} className="glass glass-lens absolute right-0 z-50 mt-2 w-72 rounded-2xl p-1.5" style={{ background: "var(--dialog)" }}>
          <p className="px-3 pt-1.5 text-xs text-muted">{t("Planned work: alerts are held back, outages are marked planned and left out of uptime, and the status page says so.")}</p>
          {win && <p className="px-3 pt-1.5 text-xs text-accent">{label}</p>}
          {runbook?.notes[0] && (
            <Link href={`/service/${encodeURIComponent(target)}#runbook`} onClick={() => setOpen(false)} className="mx-1.5 mt-2 flex items-center gap-1.5 rounded-xl bg-chip px-3 py-2 text-sm hover:bg-hover">
              <NotebookText className="h-4 w-4 text-accent" /> {t("Runbook: {name}", { name: runbook.notes[0].title })}
            </Link>
          )}
          <div className="flex flex-col gap-1.5 px-1.5 pt-2 pb-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} aria-label={t("Note for admins (optional)")} placeholder={t("Note for admins (optional)")} className={field} />
            <input
              value={publicNote}
              onChange={(e) => setPublicNote(e.target.value)}
              maxLength={200}
              aria-label={t("Message on the status page (optional)")}
              placeholder={t("Message on the status page (optional)")}
              className={field}
            />
          </div>
          <div className="px-3 py-1.5 text-xs text-muted">{t("Start now, for")}</div>
          {MAINT_CHOICES.map((c) => (
            <button key={c.label} type="button" role="menuitem" onClick={() => start(c.minutes)} className={item}>
              {t(c.label)}
            </button>
          ))}
          <div className="px-3 pt-2 pb-1.5 text-xs text-muted">{t("Or plan it")}</div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 px-3 pb-2 text-xs">
            <label htmlFor={`mf-${target}`}>{t("From")}</label>
            <input id={`mf-${target}`} type="datetime-local" value={from} min={localInput(now)} onChange={(e) => setFrom(e.target.value)} className={field} />
            <label htmlFor={`mt-${target}`}>{t("To")}</label>
            <input id={`mt-${target}`} type="datetime-local" value={to} min={from || localInput(now)} onChange={(e) => setTo(e.target.value)} className={field} />
          </div>
          <div className="px-1.5 pb-1.5">
            <button type="button" role="menuitem" disabled={!from} onClick={schedule} className="w-full rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {t("Plan maintenance")}
            </button>
          </div>
          {error && <p className="px-3 pb-2 text-xs text-[var(--err)]">{error}</p>}
          {planned.length > 0 && (
            <>
              <div className="px-3 pt-1 pb-1 text-xs text-muted">{t("Planned")}</div>
              {planned.map((m) => (
                <div key={m.id} className="flex items-center gap-2 px-3 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {clock(m.start)} → {m.end ? clock(m.end) : "…"}
                    {m.service === ALL && target !== ALL ? ` · ${t("all services")}` : ""}
                  </span>
                  <button type="button" onClick={() => end(m.id)} aria-label={t("Cancel")} title={t("Cancel")} className="rounded-full p-1 text-muted hover:bg-hover hover:text-fg">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
