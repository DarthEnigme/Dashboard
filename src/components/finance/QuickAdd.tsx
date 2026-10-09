"use client";

import { useEffect, useState, type FormEvent } from "react";
import useSWR from "swr";
import { Plus, Star, X, Zap } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Shortcut } from "@/lib/finance/recurring";
import { money } from "@/lib/finance/format";
import { inputBase } from "../edit/FieldInput";
import type { Account } from "@/lib/finance/accounts";

const today = () => new Date().toISOString().slice(0, 10);
const ACCOUNT_KEY = "page.finance.account";

/**
 * One-line entry: date, description, category, amount, expense/income, and how often it repeats.
 * Above it, shortcuts add a saved transaction with one tap.
 */
export function QuickAdd({ currency, accounts = [], account: filtered, onAdded }: { currency: string; accounts?: Account[]; account?: string; onAdded: () => void }) {
  const { data: categories } = useSWR<{ name: string }[]>("/api/finance/categories", fetcher);
  const { data: shortcuts, mutate: setShortcuts } = useSWR<Shortcut[]>("/api/finance/shortcuts", fetcher);
  const [form, setForm] = useState({ date: today(), description: "", category: "", amount: "" });
  const [income, setIncome] = useState(false);
  const [repeat, setRepeat] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  // The account new entries go to: the one being viewed, else the last one used in this browser.
  const [picked, setPicked] = useState("");
  useEffect(() => {
    try {
      setPicked(localStorage.getItem(ACCOUNT_KEY) ?? "");
    } catch {}
  }, []);
  const open = accounts.filter((a) => !a.archived);
  const account = filtered || (open.some((a) => a.name === picked) ? picked : "");
  const pickAccount = (name: string) => {
    setPicked(name);
    try {
      if (name) localStorage.setItem(ACCOUNT_KEY, name);
      else localStorage.removeItem(ACCOUNT_KEY);
    } catch {}
  };

  const parsed = () => {
    const value = Number(form.amount.replace(",", "."));
    return form.description.trim() && Number.isFinite(value) && value > 0 ? (income ? value : -value) : undefined;
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(undefined);
    try {
      setMsg({ text: await fn() });
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amount = parsed();
    if (amount === undefined) return setMsg({ text: "Enter a description and a positive amount", error: true });
    void run(async () => {
      const base = { description: form.description, category: form.category || null, amount, currency, account: account || null };
      let text = `Added ${form.description}.`;
      if (repeat) {
        const r = await sendJson<{ added: number }>("/api/finance/recurring", "POST", { ...base, every: repeat, startDate: form.date });
        text = `Added ${form.description}, repeating every ${repeat}${r.added > 1 ? ` (${r.added} past occurrences filled in)` : ""}.`;
      } else {
        await sendJson("/api/finance/transactions", "POST", { ...base, date: form.date });
      }
      setForm((f) => ({ ...f, description: "", amount: "" }));
      setRepeat("");
      onAdded();
      return text;
    });
  };

  const saveShortcut = () => {
    const amount = parsed();
    if (amount === undefined) return setMsg({ text: "Fill in a description and amount to save them as a shortcut", error: true });
    void run(async () => {
      await setShortcuts(await sendJson<Shortcut[]>("/api/finance/shortcuts", "POST", { label: form.description, amount, currency, category: form.category || null }), { revalidate: false });
      return `Saved “${form.description}” as a shortcut.`;
    });
  };

  const addShortcut = (s: Shortcut) =>
    void run(async () => {
      await sendJson("/api/finance/transactions", "POST", { date: today(), description: s.label, category: s.category, amount: s.amount_cents / 100, currency: s.currency });
      onAdded();
      return `Added ${s.label} (${money(s.amount_cents, s.currency, true)}).`;
    });

  return (
    <form onSubmit={submit} className="glass flex flex-col gap-2 rounded-2xl p-3" aria-label="Add a transaction">
      {!!shortcuts?.length && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Shortcuts">
          {shortcuts.map((s) => (
            <li key={s.id} className="group flex items-center rounded-full bg-chip text-sm">
              <button
                type="button"
                disabled={busy}
                onClick={() => addShortcut(s)}
                title={`Add ${s.label} today${s.category ? ` (${s.category})` : ""}`}
                className="flex items-center gap-1.5 rounded-full py-1 pr-1 pl-3 hover:bg-hover disabled:opacity-60"
              >
                <Zap className="h-3.5 w-3.5 text-accent" />
                {s.label}
                <span className={`tabular-nums text-xs ${s.amount_cents > 0 ? "text-[var(--ok)]" : "text-muted"}`}>{money(s.amount_cents, s.currency, true)}</span>
              </button>
              <button
                type="button"
                aria-label={`Remove shortcut ${s.label}`}
                onClick={async () => setShortcuts(await sendJson<Shortcut[]>(`/api/finance/shortcuts?id=${s.id}`, "DELETE"), { revalidate: false })}
                className="mr-1 rounded-full p-1 text-muted opacity-40 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label="Date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={`${inputBase} w-36`} />
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
          className={`${inputBase} w-32`}
        />
        <datalist id="fin-categories">
          {categories?.map((c) => <option key={c.name} value={c.name} />)}
        </datalist>
        {open.length > 0 && (
          <select aria-label="Account" value={account} onChange={(e) => pickAccount(e.target.value)} className={`${inputBase} w-32`}>
            <option value="">No account</option>
            {open.map((a) => (
              <option key={a.id} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        )}
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
          className={`${inputBase} w-28 text-right tabular-nums`}
        />
        <select aria-label="Repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={`${inputBase} w-28`} title="Repeat from the date on the left">
          <option value="">Once</option>
          <option value="week">Every week</option>
          <option value="month">Every month</option>
          <option value="year">Every year</option>
        </select>
        <button
          type="button"
          onClick={saveShortcut}
          disabled={busy}
          aria-label="Save as a shortcut"
          title="Save as a one-tap shortcut"
          className="grid h-10 w-10 place-items-center rounded-xl bg-chip text-muted hover:bg-hover hover:text-fg disabled:opacity-60"
        >
          <Star className="h-4 w-4" />
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {msg && (
        <p role={msg.error ? "alert" : "status"} className={`text-sm ${msg.error ? "text-[var(--err)]" : "text-muted"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
