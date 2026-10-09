"use client";

import { motion } from "framer-motion";
import type { Tab } from "@/lib/tabs";
import { useT } from "@/i18n/client";

export function TabBar({ tabs, active, onSelect }: { tabs: Tab[]; active: string; onSelect: (t: Tab) => void }) {
  const t = useT();
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t("Tabs")} className="glass glass-lens -mx-1 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full p-1">
      {tabs.map((t) => {
        const selected = t.name === active;
        return (
          <a
            key={t.name}
            href={`/${t.slug}`}
            aria-current={selected ? "page" : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onSelect(t);
            }}
            className={`relative shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${selected ? "text-white" : "text-muted hover:text-fg"}`}
          >
            {selected && (
              <motion.span
                layoutId="tab-pill"
                className="tab-pill absolute inset-0 rounded-full bg-accent shadow-lg shadow-accent/30"
                transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              />
            )}
            <span className="relative">{t.name}</span>
          </a>
        );
      })}
    </nav>
  );
}
