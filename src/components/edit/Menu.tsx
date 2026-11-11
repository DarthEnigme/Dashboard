"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export const menuItem = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hover disabled:opacity-40";

/**
 * A button that opens a small popover, closed by a click outside or Escape. `children` gets `close`,
 * so a menu item can close it after acting.
 */
export function Menu({ label, button, className = "", width = "w-56", children }: { label: string; button: ReactNode; className?: string; width?: string; children: (close: () => void) => ReactNode }) {
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

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} className={className || "rounded-lg p-1 text-muted hover:bg-hover hover:text-fg"}>
        {button}
      </button>
      {open && (
        <div role="menu" className={`glass absolute top-full right-0 z-30 mt-1 flex ${width} flex-col gap-0.5 rounded-2xl p-1.5`} style={{ background: "var(--dialog)" }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
