"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { CheckItem } from "@/lib/tasks/types";
import { useT } from "@/i18n/client";
import { inputClass, labelClass } from "../edit/FieldInput";

/** A task's checklist in its dialog: tick, reword, remove, or add an item (Enter adds it, without saving the task). */
export function ChecklistEditor({ items, onChange }: { items: CheckItem[]; onChange: (items: CheckItem[]) => void }) {
  const t = useT();
  const [next, setNext] = useState("");
  const change = (i: number, item: Partial<CheckItem>) => onChange(items.map((x, j) => (j === i ? { ...x, ...item } : x)));
  const add = () => {
    if (!next.trim()) return;
    onChange([...items, { text: next.trim(), done: false }]);
    setNext("");
  };
  return (
    <fieldset className={labelClass}>
      <legend className="mb-1.5">
        {t("Checklist")}
        {items.length > 0 && <span className="ml-1.5 tabular-nums">{t("{done} of {total}", { done: items.filter((x) => x.done).length, total: items.length })}</span>}
      </legend>
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            <input type="checkbox" checked={item.done} onChange={(e) => change(i, { done: e.target.checked })} aria-label={t("Done: {item}", { item: item.text })} />
            <input value={item.text} maxLength={200} onChange={(e) => change(i, { text: e.target.value })} aria-label={t("Checklist item")} className={`${inputClass} h-8 font-normal ${item.done ? "text-muted line-through" : ""}`} />
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={t("Remove {item}", { item: item.text })} className="rounded-lg p-1 text-muted hover:bg-hover hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <input
          value={next}
          maxLength={200}
          onChange={(e) => setNext(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
          placeholder={t("Add an item")}
          aria-label={t("New checklist item")}
          className={`${inputClass} h-8 font-normal`}
        />
        <button type="button" onClick={add} disabled={!next.trim()} aria-label={t("Add item")} className="rounded-lg p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </fieldset>
  );
}
