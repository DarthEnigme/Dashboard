"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "@/i18n/client";

/** Copies a code block's text; sits in its top-right corner. */
export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // no clipboard (plain http): the text can still be selected
        }
      }}
      aria-label={done ? t("Copied") : t("Copy")}
      title={done ? t("Copied") : t("Copy")}
      className="absolute top-1.5 right-1.5 rounded-lg bg-chip p-1.5 text-muted opacity-0 transition group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
    >
      {done ? <Check className="h-3.5 w-3.5 text-[var(--ok)]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
