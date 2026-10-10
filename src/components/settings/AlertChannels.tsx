"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import type { FieldSpec } from "@/integrations/fields";
import { getPath } from "../edit/FieldsDialog";
import { alertChannels } from "./sections";
import { useT } from "@/i18n/client";

type Obj = Record<string, unknown>;

const filled = (draft: Obj, key: string) => {
  const v = getPath(draft, key);
  return v !== undefined && v !== null && v !== "";
};

/**
 * The alert channels as a row of chips, one channel's fields at a time: a ✓ on the ones set up, a red
 * dot on those with a problem. `field` is the settings page's own renderer, so values, errors and
 * unsaved changes work as for any other field.
 */
export function AlertChannels({ draft, errors, field }: { draft: Obj; errors: Record<string, string>; field: (f: FieldSpec) => ReactNode }) {
  const t = useT();
  const configured = (id: string) => id !== "messages" && alertChannels.find((c) => c.id === id)!.fields.some((f) => filled(draft, f.key));
  const [active, setActive] = useState(() => alertChannels.find((c) => configured(c.id))?.id ?? alertChannels[0].id);
  const channel = alertChannels.find((c) => c.id === active) ?? alertChannels[0];

  // Arrow keys move between chips, as in any tab list.
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = alertChannels[(i + step + alertChannels.length) % alertChannels.length];
    setActive(next.id);
    document.getElementById(`alert-chip-${next.id}`)?.focus();
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4 border-t border-line pt-5">
      <h3 className="text-sm font-semibold tracking-wider text-muted uppercase">{t("Channels")}</h3>
      <div role="tablist" aria-label={t("Alert channels")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {alertChannels.map((c, i) => {
          const on = c.id === channel.id;
          const problem = c.fields.some((f) => errors[f.key]);
          return (
            <button
              key={c.id}
              id={`alert-chip-${c.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="alert-channel-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(c.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${on ? "bg-accent text-white" : "bg-chip text-muted hover:text-fg"}`}
            >
              {configured(c.id) && <Check className="h-3.5 w-3.5" aria-label={t("Set up")} />}
              {t(c.label)}
              {problem && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[var(--err)] ring-2 ring-[var(--page)]" aria-label={t("Has a problem")} />}
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={channel.id}
          id="alert-channel-panel"
          role="tabpanel"
          aria-labelledby={`alert-chip-${channel.id}`}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.18 }}
          className="grid gap-5"
        >
          {channel.fields.map((f) => field(f))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
