"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Bell, BellOff } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Mutes } from "@/lib/maintenance";
import { formatLocale } from "@/i18n/format";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";

const KEY = "/api/maintenance";
const CHOICES: { label: string; minutes: number | null }[] = [
  { label: msg("30 minutes"), minutes: 30 },
  { label: msg("2 hours"), minutes: 120 },
  { label: msg("8 hours"), minutes: 480 },
  { label: msg("Until I turn them back on"), minutes: null },
];

const clock = (t: number) => new Date(t).toLocaleString(formatLocale(), { weekday: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Admins: hold back the alerts of one service (`target` is its id) or of everything ("*") while
 * working on it. Checks keep running. `name` is what the button's label calls the target. A mute
 * can carry a note for admins and a message for the public status page.
 */
export function MuteButton({ target, name, compact }: { target: string; name: string; compact?: boolean }) {
  const t = useT();
  const { mutate } = useSWRConfig();
  const { data } = useSWR<{ mutes: Mutes }>(KEY, fetcher, { refreshInterval: 60_000 });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [publicNote, setPublicNote] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const m = data?.mutes[target];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const done = async (next: Promise<unknown>) => {
    setOpen(false);
    setNote("");
    setPublicNote("");
    await mutate(KEY, next, { revalidate: false });
    // Tiles and the monitoring panel show the "muted" marker from these.
    await mutate((key) => typeof key === "string" && (key.startsWith("/api/ping") || key === "/api/status" || key === "/api/tiles"));
  };
  const muteFor = (minutes: number | null) => done(sendJson(KEY, "POST", { service: target, minutes, note, publicNote }));
  const unmute = () => done(sendJson(`${KEY}?service=${encodeURIComponent(target)}`, "DELETE"));

  const label = m
    ? `${m.until === null ? t("Alerts for {name} are muted. Turn them back on", { name }) : t("Alerts for {name} are muted until {time}. Turn them back on", { name, time: clock(m.until) })}${m.note ? ` (${m.note})` : ""}`
    : t("Mute alerts for {name}", { name });
  const field = "w-full rounded-lg bg-chip px-2.5 py-1.5 text-sm outline-none placeholder:text-muted focus:ring-2 focus:ring-accent";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (m ? unmute() : setOpen((o) => !o))}
        aria-label={label}
        title={label}
        aria-haspopup={m ? undefined : "menu"}
        aria-expanded={m ? undefined : open}
        className={
          compact
            ? `grid h-8 w-8 place-items-center rounded-full hover:bg-hover ${m ? "text-[var(--warn)]" : "text-muted hover:text-fg"}`
            : `flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium ${m ? "bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-[var(--warn)]" : "bg-chip text-muted hover:text-fg"}`
        }
      >
        {m ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {!compact && (m ? (m.until === null ? t("Muted") : t("Muted until {time}", { time: clock(m.until) })) : t("Mute alerts"))}
      </button>
      {open && (
        <div role="menu" aria-label={t("Mute alerts for")} className="glass glass-lens absolute right-0 z-50 mt-2 w-64 rounded-2xl p-1.5" style={{ background: "var(--dialog)" }}>
          <div className="flex flex-col gap-1.5 px-1.5 pt-1 pb-2">
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
          <div className="px-3 py-1.5 text-xs text-muted">{t("Mute alerts for")}</div>
          {CHOICES.map((c) => (
            <button key={c.label} type="button" role="menuitem" onClick={() => muteFor(c.minutes)} className="flex w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-hover">
              {t(c.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
