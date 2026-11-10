"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, MoreHorizontal, Pencil } from "lucide-react";
import type { Column } from "@/lib/tasks/types";
import { useT } from "@/i18n/client";
import { DeleteButton } from "../edit/controls";

export type ColumnChange = { rename: true } | { done: boolean } | { shift: -1 | 1 } | { remove: true };

const item = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-40";

/** What can be done to a column: rename it, make it the "done" kind, move it left or right, delete it when empty. */
export function ColumnMenu({ column, first, last, onChange }: { column: Column; first: boolean; last: boolean; onChange: (change: ColumnChange) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (change: ColumnChange) => {
    setOpen(false);
    onChange(change);
  };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={t("Column options: {column}", { column: column.name })} className="rounded-lg p-1 text-muted hover:bg-hover hover:text-fg">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="glass absolute top-full right-0 z-30 mt-1 flex w-56 flex-col gap-0.5 rounded-2xl p-1.5" style={{ background: "var(--dialog)" }}>
          <button type="button" role="menuitem" className={item} onClick={() => pick({ rename: true })}>
            <Pencil className="h-4 w-4 text-muted" /> {t("Rename")}
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={column.done} className={item} onClick={() => pick({ done: !column.done })}>
            <CheckCircle2 className={`h-4 w-4 ${column.done ? "text-[var(--ok)]" : "text-muted"}`} /> {column.done ? t("Tasks here are finished") : t("Count tasks here as finished")}
          </button>
          <button type="button" role="menuitem" className={item} disabled={first} onClick={() => pick({ shift: -1 })}>
            <ArrowLeft className="h-4 w-4 text-muted" /> {t("Move left")}
          </button>
          <button type="button" role="menuitem" className={item} disabled={last} onClick={() => pick({ shift: 1 })}>
            <ArrowRight className="h-4 w-4 text-muted" /> {t("Move right")}
          </button>
          <div className="flex items-center gap-2 px-1 py-1 text-sm text-muted">
            <DeleteButton label={t("Delete column")} onConfirm={() => pick({ remove: true })} />
            {t("Delete (when empty)")}
          </div>
        </div>
      )}
    </div>
  );
}
