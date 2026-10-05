"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

// The palette (and its data) loads on first use, not with every page.
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), { ssr: false });

/** Opens the command palette from Ctrl/⌘+K anywhere, or from a "page:palette" event (header button). */
export function PaletteLauncher() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const disabled = /^\/(login|setup)\b/.test(pathname);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("page:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("page:palette", onOpen);
    };
  }, [disabled]);

  // Navigating away closes it.
  useEffect(() => setOpen(false), [pathname]);

  return open && !disabled ? <CommandPalette onClose={() => setOpen(false)} /> : null;
}
