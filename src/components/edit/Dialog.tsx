"use client";

import { useEffect, type FormEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

interface Props {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  error?: string;
  busy?: boolean;
  children: ReactNode;
}

export function Dialog({ title, onClose, onSubmit, submitLabel = "Save", error, busy, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <motion.div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
      />
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={submit}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
        // Header and buttons stay put; long forms scroll in between.
        className="glass glass-lens relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-3xl p-6"
        style={{ background: "var(--dialog)" }}
      >
        <div className="mb-5 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-muted hover:bg-hover hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="-mx-6 flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-0.5">{children}</div>
        {error && <p className="mt-4 shrink-0 rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">{error}</p>}
        <div className="mt-6 flex shrink-0 justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-muted hover:bg-hover hover:text-fg">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/30 transition hover:brightness-110 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </motion.form>
    </div>
  );
}
