"use client";

import { useState } from "react";
import useSWR from "swr";
import { Minus, Pencil, PiggyBank, Plus, Target } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Goal } from "@/lib/finance/goals";
import { money } from "@/lib/finance/format";
import type { FieldSpec } from "@/integrations/fields";
import { Dialog } from "../edit/Dialog";
import { FieldsDialog } from "../edit/FieldsDialog";
import { DeleteButton, IconButton } from "../edit/controls";
import { inputClass } from "../edit/FieldInput";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n";

const goalFields: FieldSpec[] = [
  { key: "name", label: msg("Goal"), required: true, placeholder: msg("Holiday, new laptop, emergency fund…") },
  { key: "target", label: msg("Target amount"), kind: "number", required: true },
  { key: "deadline", label: msg("Reach it by (YYYY-MM-DD)"), placeholder: "optional", help: msg("Shows how much to put aside each month.") },
];

export const GOALS_KEY = "/api/finance/goals";

/** Savings goals: a target, what is put aside, and what that takes per month. */
export function Savings({ currency }: { currency: string }) {
  const t = useT();
  const { data: goals, mutate, error } = useSWR<Goal[]>(GOALS_KEY, fetcher);
  const [editing, setEditing] = useState<Goal | "new">();
  const [moving, setMoving] = useState<{ goal: Goal; out?: boolean }>();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t("Money put aside for a goal is a move between your own pots: it is not counted as spending.")}</p>
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
          <Target className="h-4 w-4" /> {t("New goal")}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--err)]">{error.message}</p>}
      {goals?.length === 0 && (
        <div className="glass flex flex-col items-center gap-2 rounded-3xl p-10 text-center text-sm text-muted">
          <PiggyBank className="h-8 w-8" />
          {t("No savings goals yet. Create one to track what you put aside.")}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {goals?.map((g) => {
          const share = Math.min(1, Math.max(0, g.saved / g.target));
          const done = g.saved >= g.target;
          return (
            <article key={g.id} className="glass flex flex-col gap-3 rounded-3xl p-5" aria-label={g.name}>
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{g.name}</h3>
                  <p className="text-xs text-muted">
                    {g.deadline ? t("By {date}", { date: g.deadline }) : t("No deadline")}
                    {g.perMonth !== null && <> · {money(g.perMonth, g.currency)} {t("a month to make it")}</>}
                    {done && <> {t("· reached 🎉")}</>}
                  </p>
                </div>
                <div className="flex shrink-0">
                  <IconButton label={t("Edit {name}", { name: g.name })} onClick={() => setEditing(g)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <DeleteButton label={t("Delete {name}", { name: g.name })} onConfirm={async () => void mutate(await sendJson<Goal[]>(`${GOALS_KEY}?id=${g.id}`, "DELETE"), { revalidate: false })} />
                </div>
              </header>
              <div>
                <div className="mb-1 flex items-baseline justify-between gap-2 tabular-nums">
                  <span className="text-xl font-semibold">{money(g.saved, g.currency)}</span>
                  <span className="text-sm text-muted">
                    {t("of")}{" "}{money(g.target, g.currency)} · {Math.round(share * 100)}%
                  </span>
                </div>
                <div
                  className="h-2.5 overflow-hidden rounded-full bg-track"
                  role="progressbar"
                  aria-label={t("{name} progress", { name: g.name })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(share * 100)}
                >
                  <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${share * 100}%` }} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setMoving({ goal: g })} className="flex items-center gap-1.5 rounded-full bg-chip px-3 py-1.5 text-sm hover:bg-hover">
                  <Plus className="h-4 w-4" /> {t("Put aside")}
                </button>
                <button
                  onClick={() => setMoving({ goal: g, out: true })}
                  disabled={g.saved <= 0}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" /> {t("Take out")}
                </button>
              </div>
              {g.moves.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-muted">{t("Recent (")}{g.moves.length})</summary>
                  <ul className="mt-2 flex flex-col">
                    {g.moves.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 border-t border-line/50 py-1">
                        <span className="text-xs text-muted tabular-nums">{m.date}</span>
                        <span className="min-w-0 flex-1 truncate text-xs">{m.note}</span>
                        <span className={`tabular-nums ${m.amount > 0 ? "text-[var(--ok)]" : ""}`}>{money(m.amount, g.currency, true)}</span>
                        <DeleteButton
                          label={t("Delete this entry")}
                          onConfirm={async () => void mutate(await sendJson<Goal[]>(`${GOALS_KEY}?move=${m.id}`, "DELETE"), { revalidate: false })}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>

      {editing && (
        <FieldsDialog
          title={editing === "new" ? t("New savings goal") : t("Edit {name}", { name: editing.name })}
          fields={goalFields.map((f) => (f.key === "target" ? { ...f, label: t("Target amount ({currency})", { currency: editing === "new" ? currency : editing.currency }) } : f))}
          initial={editing === "new" ? {} : { name: editing.name, target: editing.target / 100, deadline: editing.deadline ?? "" }}
          onClose={() => setEditing(undefined)}
          onSave={async (v) => {
            const body = { ...v, deadline: v.deadline || null };
            await mutate(await sendJson<Goal[]>(GOALS_KEY, editing === "new" ? "POST" : "PATCH", editing === "new" ? body : { ...body, id: editing.id }), { revalidate: false });
          }}
        />
      )}
      {moving && goals && <SaveDialog goals={goals} goalId={moving.goal.id} out={moving.out} onClose={() => setMoving(undefined)} onDone={(list) => mutate(list, { revalidate: false })} />}
    </section>
  );
}

/** Put money aside for a goal (or take it out). Also behind the Savings button in the finance header. */
export function SaveDialog({
  goals,
  goalId,
  out = false,
  onClose,
  onDone,
}: {
  goals: Goal[];
  goalId?: number;
  out?: boolean;
  onClose: () => void;
  onDone: (goals: Goal[]) => void;
}) {
  const t = useT();
  const [id, setId] = useState(goalId ?? goals[0]?.id);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [takeOut, setTakeOut] = useState(out);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const goal = goals.find((g) => g.id === id);

  const submit = async () => {
    const v = Number(amount.replace(",", "."));
    if (!goal) return setError(t("Pick a goal"));
    if (!Number.isFinite(v) || v <= 0) return setError(t("Enter a positive amount"));
    setBusy(true);
    setError(undefined);
    try {
      onDone(await sendJson<Goal[]>(`${GOALS_KEY}/move`, "POST", { id, amount: takeOut ? -v : v, note }));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={takeOut ? t("Take money out of savings") : t("Put money aside")} onClose={onClose} onSubmit={submit} submitLabel={takeOut ? t("Take out") : t("Save")} error={error} busy={busy}>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{t("Goal")}</span>
        <select value={id} onChange={(e) => setId(Number(e.target.value))} className={inputClass}>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({money(g.saved, g.currency)} {t("of")}{" "}{money(g.target, g.currency)})
            </option>
          ))}
        </select>
      </label>
      <div className="flex rounded-xl bg-chip p-0.5 text-sm" role="group" aria-label={t("Direction")}>
        {[false, true].map((o) => (
          <button
            key={String(o)}
            type="button"
            aria-pressed={takeOut === o}
            onClick={() => setTakeOut(o)}
            className={`flex-1 rounded-lg px-3 py-1.5 ${takeOut === o ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
          >
            {o ? t("Take out") : t("Put aside")}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{t("Amount")}{goal ? ` (${goal.currency})` : ""}</span>
        <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputClass} tabular-nums`} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">{t("Note")}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("optional")} maxLength={200} className={inputClass} />
      </label>
    </Dialog>
  );
}
