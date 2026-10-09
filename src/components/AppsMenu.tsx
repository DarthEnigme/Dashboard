"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import type { AppSection } from "@/lib/sections";

const round = "glass glass-interactive grid h-11 w-11 shrink-0 place-items-center rounded-full";

/**
 * The sections next to the dashboard (Finance, Travel…): one button when there is one, else an
 * "Apps" button with a menu, so the header doesn't grow with every section.
 */
export function AppsMenu({ sections }: { sections: AppSection[] }) {
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

  if (!sections.length) return null;
  if (sections.length === 1) {
    const s = sections[0];
    return (
      <Link href={s.href} className={round} aria-label={s.label} title={s.label}>
        <s.icon className="h-4 w-4" />
      </Link>
    );
  }
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={round} aria-label="Apps" title="Apps" aria-haspopup="menu" aria-expanded={open}>
        <LayoutGrid className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" aria-label="Apps" className="glass absolute top-full right-0 z-40 mt-2 grid w-56 grid-cols-2 gap-1 rounded-2xl p-1.5" style={{ background: "var(--dialog)" }}>
          {sections.map((s) => (
            <Link key={s.id} role="menuitem" href={s.href} className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-sm hover:bg-hover">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-chip text-accent">
                <s.icon className="h-4.5 w-4.5" />
              </span>
              {s.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
