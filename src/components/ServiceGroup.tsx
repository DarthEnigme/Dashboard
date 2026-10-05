"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { ClientGroup, ClientSettings } from "@/lib/config/sanitize";
import { ServiceCard } from "./ServiceCard";

const storageKey = (name: string) => `page:collapsed:${name}`;

/** Collapsed state: the config value is the default, each browser remembers its own choice. */
function useCollapsed(name: string, initial: boolean) {
  const [collapsed, setCollapsed] = useState(initial);
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey(name));
      if (v !== null) setCollapsed(v === "1");
    } catch {}
  }, [name]);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(storageKey(name), c ? "0" : "1");
      } catch {}
      return !c;
    });
  return [collapsed, toggle] as const;
}

interface Props {
  group: ClientGroup;
  settings: ClientSettings;
  index: number;
  /** While filtering, groups are always expanded and labelled with their tab. */
  forceOpen?: boolean;
  tabLabel?: string;
  canAct?: boolean;
}

export function ServiceGroup({ group: g, settings, index, forceOpen, tabLabel, canAct }: Props) {
  const [collapsed, toggle] = useCollapsed(g.name, !!g.collapsed);
  const open = forceOpen || !collapsed;
  const cols = g.columns ?? settings.columns;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.06, 0.3) }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group mb-3 flex items-center gap-1.5 px-1 text-sm font-semibold tracking-wider text-muted uppercase hover:text-fg"
      >
        {g.name}
        {tabLabel && <span className="rounded-full bg-track px-2 py-0.5 text-[10px] tracking-normal normal-case">{tabLabel}</span>}
        <ChevronDown
          className={`h-4 w-4 transition ${open ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : "-rotate-90"}`}
        />
        {!open && <span className="text-xs font-normal tracking-normal normal-case">({g.services.length})</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            // Clip only while animating, so hover lift and shadows aren't cut off.
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
            transition={{ duration: 0.25 }}
          >
            <div className="svc-grid" data-cols={cols ? "" : undefined} style={{ "--cols": cols } as CSSProperties}>
              {g.services.map((s) => (
                <ServiceCard key={s.id} service={s} settings={settings} canAct={canAct} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
