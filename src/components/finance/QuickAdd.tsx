"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { inputBase } from "../edit/FieldInput";

const today = () => new Date().toISOString().slice(0, 10);

/** One-line entry: date, description, category, amount, expense/income. */
export function QuickAdd({ currency, onAdded }: { currency: string; onAdded: () => void }) {
  const { data: categories } = useSWR<{ name: string }[]>("/api/finance/categories", fetcher);
  const [form, setForm] = useState({ date: today(), description: "", category: "", amount: "" });
  const [income, setIncome] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(form.amount.replace(",", "."));
    if (!form.description.trim() || !Number.isFinite(value) || value <= 0) {
      return setError("Enter a description and a positive amount");
    }
    setBusy(true);
    setError(undefined);
    try {
      await sendJson("/api/finance/transactions", "POST", {
        date: form.date,
        description: form.description,
        category: form.category || null,
        amount: income ? value : -value,
      });
      setForm((f) => ({ ...f, description: "", amount: "" }));
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass flex flex-col gap-2 rounded-2xl p-3" aria-label="Add a transaction">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label="Date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={`${inputBase} w-40`} />
        <input
          aria-label="Description"
          placeholder="Groceries, salary…"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className={`${inputBase} min-w-40 flex-1`}
        />
        <input
          aria-label="Category"
          placeholder="Category"
          list="fin-categories"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className={`${inputBase} w-40`}
        />
        <datalist id="fin-categories">
          {categories?.map((c) => <option key={c.name} value={c.name} />)}
        </datalist>
        <div className="flex rounded-xl bg-chip p-0.5 text-sm" role="group" aria-label="Type">
          {[false, true].map((inc) => (
            <button
              key={String(inc)}
              type="button"
              aria-pressed={income === inc}
              onClick={() => setIncome(inc)}
              className={`rounded-lg px-3 py-1.5 ${income === inc ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
            >
              {inc ? "Income" : "Expense"}
            </button>
          ))}
        </div>
        <input
          aria-label={`Amount in ${currency}`}
          inputMode="decimal"
          placeholder={`0.00 ${currency}`}
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className={`${inputBase} w-32 text-right tabular-nums`}
        />
        <button
          type="submit"
          disabled={busy}
          className="flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}
    </form>
  );
}
