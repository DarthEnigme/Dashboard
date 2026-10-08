"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { Pause, Play, Plus, Repeat } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Projection } from "@/lib/finance/projection";
import type { RecurringRule } from "@/lib/finance/recurring";
import { money, monthLabel } from "@/lib/finance/format";
import { LineChart } from "../charts/LineChart";
import { DeleteButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";

type Rule = RecurringRule & { next: string | null };

const today = () => new Date().toISOString().slice(0, 10);
const EVERY_LABEL = { week: "week", month: "month", year: "year" } as const;
const everyText = (r: Pick<RecurringRule, "every" | "every_n">) => (r.every_n === 1 ? `every ${EVERY_LABEL[r.every]}` : `every ${r.every_n} ${EVERY_LABEL[r.every]}s`);

/** Where the balance is heading, and the recurring transactions that drive it. */
export function Plan({ currency, onChanged }: { currency: string; onChanged: () => void }) {
  const { data: p } = useSWR<Projection & { currency: string }>(`/api/finance/projection?currency=${currency}`, fetcher, { keepPreviousData: true });
  const { data: rules, mutate } = useSWR<Rule[]>("/api/finance/recurring", fetcher);
  const [error, setError] = useState<string>();

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      await mutate();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // One balance line: solid for what happened, dashed for the estimate (joined at this month).
  const hist = p?.history ?? [];
  const proj = p?.months ?? [];
  const x = [...hist, ...proj].map((m) => Date.parse(`${m.month}-01T00:00:00Z`));
  const cur = p?.currency ?? currency;

  return (
    <section className="flex flex-col gap-3">
      {p && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Balance today" value={money(p.balance, cur)} />
          <Stat label="Expected end of this month" value={money(proj[0]?.cents ?? p.balance, cur)} tone={(proj[0]?.cents ?? 0) < 0 ? "bad" : undefined} />
          <Stat label="In 12 months" value={money(proj[proj.length - 1]?.cents ?? p.balance, cur)} tone={(proj[proj.length - 1]?.cents ?? 0) < 0 ? "bad" : undefined} />
          <Stat label="Each month" value={money(p.recurring + p.variable, cur, true)} note={`${money(p.recurring, cur, true)} recurring, ${money(p.variable, cur, true)} the rest`} />
        </div>
      )}
      {p && x.length > 1 && (
        <section className="glass rounded-3xl p-5" aria-labelledby="projection-title">
          <h2 id="projection-title" className="mb-1 text-sm font-semibold">
            Balance and projection
          </h2>
          <p className="mb-3 text-xs text-muted">
            The projection adds your recurring transactions and the average of everything else over the last three months. It is a trend, not a promise.
          </p>
          <LineChart
            x={x}
            series={[
              { name: "Balance", color: "var(--series-1)", values: [...hist.map((m) => m.cents / 100), ...proj.map(() => null)] },
              {
                name: "Projected",
                color: "var(--series-1)",
                dashed: true,
                values: [...hist.map((m, i) => (i === hist.length - 1 ? m.cents / 100 : null)), ...proj.map((m) => m.cents / 100)],
              },
            ]}
            height={220}
            formatX={(t) => monthLabel(new Date(t).toISOString().slice(0, 7), true)}
            ariaLabel="Balance for the last six months and the projection for the next twelve"
          />
        </section>
      )}

      <section className="glass flex flex-col gap-3 rounded-3xl p-4" aria-labelledby="recurring-title">
        <h2 id="recurring-title" className="flex items-center gap-2 font-semibold">
          <Repeat className="h-4 w-4 text-accent" /> Recurring transactions
        </h2>
        <p className="text-sm text-muted">Rent, salary, subscriptions: each one is added as a transaction on its date. Deleting a rule keeps what it already added.</p>
        {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}
        <NewRule currency={currency} onCreate={(body) => act(() => sendJson("/api/finance/recurring", "POST", body))} />
        {rules?.length === 0 && <p className="py-4 text-center text-sm text-muted">No recurring transactions yet.</p>}
        {!!rules?.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-2 py-1.5 font-medium">Description</th>
                  <th className="px-2 py-1.5 font-medium">Repeats</th>
                  <th className="px-2 py-1.5 font-medium">Next</th>
                  <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className={`border-t border-line/50 ${r.active ? "" : "text-muted"}`}>
                    <td className="max-w-72 truncate px-2 py-1.5">
                      {r.description}
                      {r.category && <span className="ml-2 rounded-full bg-chip px-2 py-0.5 text-xs">{r.category}</span>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {everyText(r)}
                      {r.end_date && <span className="text-xs text-muted"> until {r.end_date}</span>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{!r.active ? "paused" : (r.next ?? "ended")}</td>
                    <td className={`px-2 py-1.5 text-right whitespace-nowrap tabular-nums ${r.amount_cents > 0 ? "text-[var(--ok)]" : ""}`}>{money(r.amount_cents, r.currency, true)}</td>
                    <td className="px-1 py-1">
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => act(() => sendJson("/api/finance/recurring", "PATCH", { id: r.id, active: !r.active }))}
                          aria-label={r.active ? `Pause ${r.description}` : `Resume ${r.description}`}
                          title={r.active ? "Pause" : "Resume (adds what came due meanwhile)"}
                          className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg"
                        >
                          {r.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </button>
                        <DeleteButton label={`Delete ${r.description}`} onConfirm={() => act(() => sendJson(`/api/finance/recurring?id=${r.id}`, "DELETE"))} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function NewRule({ currency, onCreate }: { currency: string; onCreate: (body: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({ description: "", amount: "", category: "", every: "month", everyN: "1", startDate: today(), endDate: "" });
  const [income, setIncome] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = Number(f.amount.replace(",", "."));
    if (!f.description.trim() || !Number.isFinite(v) || v <= 0) return setError("Enter a description and a positive amount");
    setError(undefined);
    await onCreate({ ...f, everyN: Number(f.everyN) || 1, amount: income ? v : -v, currency, endDate: f.endDate || null, category: f.category || null });
    setF((x) => ({ ...x, description: "", amount: "", category: "" }));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-2xl bg-chip p-3" aria-label="Add a recurring transaction">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Description" placeholder="Rent, Netflix, salary…" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={`${inputBase} min-w-40 flex-1`} />
        <input aria-label="Category" placeholder="Category" list="fin-categories" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={`${inputBase} w-36`} />
        <div className="flex rounded-xl bg-track p-0.5 text-sm" role="group" aria-label="Type">
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
        <input aria-label={`Amount in ${currency}`} inputMode="decimal" placeholder={`0.00 ${currency}`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={`${inputBase} w-28 text-right tabular-nums`} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        Every
        <input aria-label="Repeat every" type="number" min={1} max={52} value={f.everyN} onChange={(e) => setF({ ...f, everyN: e.target.value })} className={`${inputBase} w-16`} />
        <select aria-label="Period" value={f.every} onChange={(e) => setF({ ...f, every: e.target.value })} className={`${inputBase} w-28`}>
          <option value="week">week(s)</option>
          <option value="month">month(s)</option>
          <option value="year">year(s)</option>
        </select>
        from
        <input aria-label="Start date" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className={`${inputBase} w-40`} />
        until
        <input aria-label="End date (optional)" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} className={`${inputBase} w-40`} />
        <button type="submit" className="ml-auto flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}
      <p className="text-xs text-muted">A start date in the past adds the occurrences since then.</p>
    </form>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "bad" }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === "bad" ? "text-[var(--err)]" : ""}`}>{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  );
}
