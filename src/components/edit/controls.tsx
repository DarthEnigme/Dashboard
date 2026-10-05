"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

export function ToolButton({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-fg/90 hover:bg-hover">
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg">
      {children}
    </button>
  );
}

/** Two-step delete: the first click arms the button for a few seconds. */
export function DeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      aria-label={armed ? `Confirm: ${label}` : label}
      title={armed ? "Click again to delete" : label}
      className={`flex items-center gap-1 rounded-lg p-1.5 text-xs transition ${
        armed ? "bg-[var(--err)]/20 px-2 text-[var(--err)]" : "text-muted hover:bg-hover hover:text-[var(--err)]"
      }`}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {armed && "Delete?"}
    </button>
  );
}

export function EmptyAdd({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-4 text-sm text-muted transition hover:border-accent hover:text-fg"
    >
      <Plus className="h-4 w-4" /> {children}
    </button>
  );
}
