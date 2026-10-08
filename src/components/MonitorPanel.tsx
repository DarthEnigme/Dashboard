"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import useSWR from "swr";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, CheckCircle2, CircleDashed, Search, X, XCircle } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { StatusRow } from "@/app/api/status/route";
import { duration } from "@/integrations/format";
import { Icon } from "./Icon";

type Filter = "all" | "down" | "up";

const since = (t: number) => duration(Math.max(1, Math.round((Date.now() - t) / 1000)));

/**
 * Header button with the number of services down, opening a panel from the right edge with every
 * monitored service: status, latency, 24-hour uptime and open outages. Also opens with "m" or the
 * page:monitor event (command palette).
 */
export function MonitorPanel({ refreshSeconds }: { refreshSeconds: number }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const { data } = useSWR<StatusRow[]>("/api/status", fetcher, { refreshInterval: Math.max(10, refreshSeconds) * 1000 });
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "m" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) toggle();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("page:monitor", toggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("page:monitor", toggle);
    };
  }, []);

  // Focus moves into the panel when it opens and back to the button when it closes.
  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (document.activeElement === document.body) opener.current?.focus({ preventScroll: true });
  }, [open]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter((r) => filter === "all" || (filter === "down" ? r.up === false : r.up === true))
      .filter((r) => !term || `${r.name} ${r.group} ${r.check}`.toLowerCase().includes(term))
      // Down first, then unknown, then up; by name within each.
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [data, filter, q]);

  if (!data?.length) return null;
  const down = data.filter((r) => r.up === false).length;
  const up = data.filter((r) => r.up === true).length;

  return (
    <>
      <button
        ref={opener}
        onClick={() => setOpen(true)}
        className="glass glass-interactive relative grid h-11 w-11 shrink-0 place-items-center rounded-full"
        aria-label={down ? `Monitoring: ${down} down` : "Monitoring: all up"}
        title={down ? `${down} down (m)` : "Monitoring (m)"}
      >
        <Activity className="h-4 w-4" />
        {down > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--err)] px-1 text-[11px] font-semibold text-white ring-2 ring-[var(--page)]">
            {down}
          </span>
        )}
      </button>
      {/* On <body>: inside the header, its stacking context would put later header buttons on top. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <>
                <motion.div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
                <motion.aside
                  role="dialog"
                  aria-modal="true"
                  aria-label="Monitoring"
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ type: "spring", bounce: 0, duration: 0.35 }}
                  className="glass glass-lens fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col gap-3 rounded-l-3xl p-5 sm:p-6"
                  style={{ background: "var(--dialog)" }}
                >
                  <header className="flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <Activity className="h-5 w-5 text-accent" /> Monitoring
                    </h2>
                    <button ref={closeRef} onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-hover hover:text-fg">
                      <X className="h-5 w-5" />
                    </button>
                  </header>
                  <p className="text-sm text-muted">
                    {up} up · <span className={down ? "font-medium text-[var(--err)]" : ""}>{down} down</span>
                    {data.length - up - down > 0 && <> · {data.length - up - down} not checked yet</>}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-full bg-chip p-0.5 text-sm" role="group" aria-label="Show">
                      {(["all", "down", "up"] as const).map((f) => (
                        <button
                          key={f}
                          aria-pressed={filter === f}
                          onClick={() => setFilter(f)}
                          className={`rounded-full px-3 py-1 capitalize ${filter === f ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                    <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-chip px-3">
                      <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" aria-label="Filter services" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                    </label>
                  </div>
                  <ul className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto">
                    {rows.map((r) => (
                      <li key={r.id}>
                        <Link href={`/service/${r.id}`} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-hover">
                          <Status up={r.up} />
                          <Icon icon={r.icon} name={r.name} size={24} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{r.name}</span>
                            <span className="block truncate text-xs text-muted">
                              {r.incident ? <span className="text-[var(--err)]">down for {since(r.incident.since)}{r.incident.cause ? ` · ${r.incident.cause}` : ""}</span> : `${r.group} · ${r.check}`}
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-xs tabular-nums">
                            <span className="block">{r.up && r.latencyMs !== null ? `${r.latencyMs} ms` : r.up === false ? "down" : "–"}</span>
                            <span className="block text-muted">{r.uptime === null ? "" : `${(r.uptime * 100).toFixed(r.uptime === 1 ? 0 : 1)}% 24h`}</span>
                            {r.certDaysLeft !== null && r.certDaysLeft < 15 && <span className="block text-[var(--warn)]">cert {r.certDaysLeft} d</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                    {!rows.length && <li className="py-10 text-center text-sm text-muted">{filter === "down" ? "Nothing is down. 🎉" : "No service matches."}</li>}
                  </ul>
                  <p className="text-xs text-muted">Press m to open or close this panel.</p>
                </motion.aside>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

const rank = (r: StatusRow) => (r.up === false ? 0 : r.up === null ? 1 : 2);

/** Icon plus colour, so state never relies on colour alone. */
function Status({ up }: { up: boolean | null }) {
  if (up === null) return <CircleDashed className="h-4 w-4 shrink-0 text-muted" aria-label="Not checked yet" />;
  return up ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ok)]" aria-label="Up" /> : <XCircle className="h-4 w-4 shrink-0 text-[var(--err)]" aria-label="Down" />;
}
