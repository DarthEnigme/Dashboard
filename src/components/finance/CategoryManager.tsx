"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { Pencil } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { FieldSpec } from "@/integrations/fields";
import { FieldsDialog } from "../edit/FieldsDialog";
import { DeleteButton, IconButton } from "../edit/controls";

type Cat = { name: string; slot: number | null; color: string | null; budget: number | null; count: number };

const renameFields: FieldSpec[] = [
  { key: "rename", label: "New name", required: true, help: "Use an existing category's name to merge into it." },
];

/**
 * Chart colours are the eight palette slots, each owned by at most one category (never reused,
 * never cycled), checked for colour-blind safety. Past eight, a category can take its own colour;
 * categories with neither are grouped as "Other" in charts.
 */
export function CategoryManager({ onChanged, currency }: { onChanged: () => void; currency: string }) {
  const { data, mutate } = useSWR<Cat[]>("/api/finance/categories", fetcher);
  const [renaming, setRenaming] = useState<Cat>();
  const [error, setError] = useState<string>();
  const colorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const post = async (body: Record<string, unknown>) => {
    setError(undefined);
    try {
      await mutate(await sendJson<Cat[]>("/api/finance/categories", "POST", body), { revalidate: false });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="glass flex flex-col gap-2 rounded-3xl p-4">
      <p className="text-sm text-muted">
        Pick a chart colour per category. The eight palette colours are easy to tell apart, also for colour-blind people. For more
        categories, pick your own colour with <em>Custom</em>. A category without a colour is shown as <em>Other</em>. A monthly
        budget adds the category to the Budgets card and alerts you when it is used up.
      </p>
      {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}
      {data?.length === 0 && <p className="py-6 text-center text-sm text-muted">Categories appear as you add transactions.</p>}
      {data?.map((c) => (
        <div key={c.name} className="flex flex-wrap items-center gap-3 rounded-xl bg-chip px-3 py-2">
          <span className="min-w-32 flex-1 font-medium">{c.name}</span>
          <span className="text-xs text-muted">{c.count} transactions</span>
          <div className="flex items-center gap-1" role="radiogroup" aria-label={`Colour for ${c.name}`}>
            {Array.from({ length: 8 }, (_, i) => i + 1).map((slot) => (
              <button
                key={slot}
                role="radio"
                aria-checked={!c.color && c.slot === slot}
                aria-label={`Colour ${slot}`}
                onClick={() => post({ name: c.name, slot, ...(c.color ? { color: null } : {}) })}
                className={`h-5 w-5 rounded-md transition ${!c.color && c.slot === slot ? "ring-2 ring-fg ring-offset-2 ring-offset-transparent" : "opacity-70 hover:opacity-100"}`}
                style={{ background: `var(--series-${slot})` }}
              />
            ))}
            <label
              title="Your own colour"
              className={`relative flex h-5 cursor-pointer items-center gap-1 rounded-md border border-line px-1.5 text-[10px] text-muted ${c.color ? "ring-2 ring-fg" : ""}`}
            >
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c.color ?? "conic-gradient(#e66767, #c98500, #199e70, #3987e5, #9085e9, #e66767)" }} />
              Custom
              <input
                type="color"
                aria-label={`Custom colour for ${c.name}`}
                value={c.color ?? "#888888"}
                // Dragging in the picker fires a change per step: save once it settles.
                onChange={(e) => {
                  const v = e.target.value;
                  clearTimeout(colorTimer.current);
                  colorTimer.current = setTimeout(() => v !== c.color && post({ name: c.name, color: v }), 500);
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            <button
              role="radio"
              aria-checked={c.slot === null && !c.color}
              aria-label="No colour (Other)"
              onClick={() => post({ name: c.name, slot: null, color: null })}
              className={`h-5 rounded-md border border-line px-1.5 text-[10px] text-muted ${c.slot === null && !c.color ? "ring-2 ring-fg" : ""}`}
            >
              Other
            </button>
          </div>
          <BudgetInput key={`${c.name}-${c.budget}`} cat={c} currency={currency} onSave={(budget) => post({ name: c.name, budget })} />
          <IconButton label={`Rename ${c.name}`} onClick={() => setRenaming(c)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <DeleteButton
            label={`Delete ${c.name}`}
            onConfirm={async () => {
              await mutate(await sendJson<Cat[]>(`/api/finance/categories?name=${encodeURIComponent(c.name)}`, "DELETE"), { revalidate: false });
              onChanged();
            }}
          />
        </div>
      ))}
      {renaming && (
        <FieldsDialog
          title={`Rename ${renaming.name}`}
          fields={renameFields}
          initial={{ rename: renaming.name }}
          onClose={() => setRenaming(undefined)}
          onSave={async (v) => {
            await mutate(await sendJson<Cat[]>("/api/finance/categories", "POST", { name: renaming.name, rename: v.rename }), { revalidate: false });
            onChanged();
          }}
        />
      )}
    </section>
  );
}

/** Monthly budget in the main currency; saved on blur or Enter, empty removes it. */
function BudgetInput({ cat, currency, onSave }: { cat: Cat; currency: string; onSave: (cents: number | null) => void }) {
  const [text, setText] = useState(cat.budget ? String(cat.budget / 100) : "");
  const commit = () => {
    const v = text.trim().replace(",", ".");
    const cents = v ? Math.round(Number(v) * 100) : null;
    if (cents !== null && (!Number.isFinite(cents) || cents < 0)) return setText(cat.budget ? String(cat.budget / 100) : "");
    if (cents !== (cat.budget ?? null)) onSave(cents);
  };
  return (
    <label className="flex items-center gap-1 text-xs text-muted">
      Budget
      <input
        inputMode="decimal"
        value={text}
        placeholder="none"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        aria-label={`Monthly budget for ${cat.name} (${currency})`}
        className="w-20 rounded-lg bg-track px-2 py-1 text-right text-sm text-fg tabular-nums outline-none focus:ring-2 focus:ring-accent/60"
      />
      <span>{currency}/mo</span>
    </label>
  );
}
