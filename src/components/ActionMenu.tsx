"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Loader2, MoreHorizontal, Play, Power, RotateCw, Square } from "lucide-react";
import { useSWRConfig } from "swr";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { ClientService } from "@/lib/config/sanitize";
import type { ServiceAction } from "@/integrations/types";
import { Dialog } from "./edit/Dialog";

const icons: Record<string, typeof Play> = { start: Play, stop: Square, shutdown: Power, restart: RotateCw, reboot: RotateCw, snapshot: Camera };

/** Admin-only ⋯ menu: lists the actions the integration offers right now, confirms, runs. */
export function ActionMenu({ service }: { service: ClientService }) {
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState<ServiceAction[]>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState<ServiceAction>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error?: boolean }>();
  const ref = useRef<HTMLDivElement>(null);
  const { mutate } = useSWRConfig();
  const base = `/api/actions/${encodeURIComponent(service.id)}`;

  useEffect(() => {
    if (!open) return;
    setActions(undefined);
    setError(undefined);
    fetcher<ServiceAction[]>(base).then(setActions, (e) => setError((e as Error).message));
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, base]);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(undefined), 6000);
    return () => clearTimeout(t);
  }, [result]);

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const r = await sendJson<{ message: string }>(base, "POST", { action: confirm.id, target: confirm.target });
      setResult({ text: r.message });
      // Refresh the tile's data right away (and again shortly, as the state settles).
      const key = `/api/widget/${encodeURIComponent(service.id)}`;
      mutate(key);
      setTimeout(() => mutate(key), 4000);
    } catch (e) {
      setResult({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
      setConfirm(undefined);
    }
  };

  // Group per target (Proxmox guests); actions on the service itself come first.
  const groups = new Map<string, ServiceAction[]>();
  for (const a of actions ?? []) groups.set(a.targetLabel ?? "", [...(groups.get(a.targetLabel ?? "") ?? []), a]);

  return (
    <div ref={ref} className="relative z-20 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${service.name}`}
        className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-hover hover:text-fg"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="glass glass-lens absolute right-0 mt-1 max-h-80 w-60 overflow-y-auto rounded-2xl p-1.5"
            style={{ background: "var(--dialog)" }}
          >
            {!actions && !error && (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {error && <div className="px-3 py-2 text-sm text-[var(--err)]">{error}</div>}
            {actions?.length === 0 && <div className="px-3 py-2 text-sm text-muted">No actions available.</div>}
            {[...groups].map(([label, list]) => (
              <div key={label} className="py-0.5">
                {label && <div className="px-3 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</div>}
                {list.map((a) => {
                  const ActionIcon = icons[a.id] ?? Power;
                  return (
                    <button
                      key={`${a.target}|${a.id}`}
                      role="menuitem"
                      aria-label={a.targetLabel ? `${a.label} ${a.targetLabel}` : a.label}
                      onClick={() => {
                        setOpen(false);
                        setConfirm(a);
                      }}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-sm hover:bg-hover ${a.danger ? "text-[var(--err)]" : ""}`}
                    >
                      <ActionIcon className="h-4 w-4" /> {a.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {confirm && (
        <Dialog
          title={`${confirm.label} ${confirm.targetLabel ?? service.name}?`}
          submitLabel={confirm.label}
          busy={busy}
          onClose={() => setConfirm(undefined)}
          onSubmit={run}
        >
          <p className="text-sm text-muted">
            {confirm.danger
              ? "This cuts power without a clean shutdown and can lose unsaved data."
              : confirm.id === "snapshot"
                ? `This takes a snapshot of ${confirm.targetLabel ?? service.name} now (named page-<date>).`
                : `This will ${confirm.label.toLowerCase()} ${confirm.targetLabel ?? service.name} now.`}
          </p>
        </Dialog>
      )}

      {result && (
        <div
          role="status"
          className={`glass fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-2xl px-4 py-3 text-sm ${result.error ? "text-[var(--err)]" : ""}`}
          style={{ background: "var(--dialog)" }}
        >
          {result.text}
        </div>
      )}
    </div>
  );
}
