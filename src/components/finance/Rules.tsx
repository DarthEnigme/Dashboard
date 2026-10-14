"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowDown, ArrowUp, Pencil, Wand2 } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Rule, RuleMode } from "@/lib/finance/rules";
import { DeleteButton, IconButton } from "../edit/controls";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";

const KEY = "/api/finance/rules";
type Answer = { rules: Rule[]; pending: number };
const MODES: { id: RuleMode; label: string }[] = [
  { id: "contains", label: msg("contains") },
  { id: "starts", label: msg("starts with") },
  { id: "equals", label: msg("is exactly") },
  { id: "regex", label: msg("matches the pattern") },
];
const empty = { match: "", mode: "contains" as RuleMode, category: "", account: "" };
const field = "rounded-lg bg-track px-2.5 py-1.5 text-sm text-fg outline-none focus:ring-2 focus:ring-accent/60";

/**
 * Category rules: a transaction added without a category (by hand, from a CSV, from Firefly or a
 * recurring payment) gets the category of the first rule its description matches.
 */
export function RulesPanel({ categories, onChanged, prefill }: { categories: string[]; onChanged: () => void; prefill?: string }) {
  const t = useT();
  const { data, mutate } = useSWR<Answer>(KEY, fetcher);
  const [form, setForm] = useState({ ...empty, match: prefill ?? "" });
  const [editing, setEditing] = useState<number>();
  const [test, setTest] = useState("");
  const [error, setError] = useState<string>();
  const [applied, setApplied] = useState<number>();
  const { data: tested } = useSWR<{ rule: Rule | null }>(test.trim() ? `${KEY}?test=${encodeURIComponent(test)}` : null, fetcher);

  const run = async (p: Promise<Answer>) => {
    setError(undefined);
    try {
      await mutate(await p, { revalidate: false });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const save = async () => {
    const ok = await run(editing ? sendJson<Answer>(KEY, "PATCH", { id: editing, ...form }) : sendJson<Answer>(KEY, "POST", form));
    if (ok) {
      setForm(empty);
      setEditing(undefined);
    }
  };
  const apply = async () => {
    setError(undefined);
    try {
      const r = await sendJson<{ changed: number }>(`${KEY}/apply`, "POST");
      setApplied(r.changed);
      await mutate();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const modeLabel = (m: RuleMode) => t(MODES.find((x) => x.id === m)?.label ?? m);

  return (
    <section className="glass flex flex-col gap-3 rounded-3xl p-4" aria-labelledby="rules-heading">
      <h2 id="rules-heading" className="flex items-center gap-2 font-semibold">
        <Wand2 className="h-4 w-4 text-accent" /> {t("Rules")}
      </h2>
      <p className="text-sm text-muted">{t("Transactions added without a category get the category of the first rule their description matches. A category set by hand, by the file or by Firefly is kept.")}</p>
      {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}

      <ol className="flex flex-col gap-1.5">
        {data?.rules.map((r, i) => (
          <li key={r.id} data-rule={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-chip px-3 py-2 text-sm">
            <span className="w-5 text-xs text-muted tabular-nums">{i + 1}.</span>
            <span className="min-w-0 flex-1">
              {t("Description")} {modeLabel(r.mode)} <code className="rounded bg-track px-1">{r.match}</code>
              {r.account && <span className="text-muted"> · {t("account {name}", { name: r.account })}</span>} → <strong>{r.category}</strong>
            </span>
            <IconButton label={t("Try earlier")} onClick={() => run(sendJson<Answer>(KEY, "PATCH", { id: r.id, move: "up" }))}>
              <ArrowUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label={t("Try later")} onClick={() => run(sendJson<Answer>(KEY, "PATCH", { id: r.id, move: "down" }))}>
              <ArrowDown className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              label={t("Edit rule")}
              onClick={() => {
                setEditing(r.id);
                setForm({ match: r.match, mode: r.mode, category: r.category, account: r.account ?? "" });
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
            <DeleteButton label={t("Delete rule")} onConfirm={() => run(sendJson<Answer>(`${KEY}?id=${r.id}`, "DELETE"))} />
          </li>
        ))}
        {data && !data.rules.length && <li className="py-3 text-center text-sm text-muted">{t("No rules yet.")}</li>}
      </ol>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <span className="text-sm text-muted">{t("Description")}</span>
        <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as RuleMode })} aria-label={t("How to match")} className={field}>
          {MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.label)}
            </option>
          ))}
        </select>
        <input value={form.match} onChange={(e) => setForm({ ...form, match: e.target.value })} placeholder="NETFLIX" aria-label={t("Text to match")} className={`${field} w-40`} />
        <span className="text-sm text-muted">→</span>
        <input
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          list="fin-rule-categories"
          placeholder={t("Category")}
          aria-label={t("Category")}
          className={`${field} w-40`}
        />
        <datalist id="fin-rule-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder={t("Any account")} aria-label={t("Only for account")} className={`${field} w-32`} />
        <button type="submit" disabled={!form.match.trim() || !form.category.trim()} className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
          {editing ? t("Save rule") : t("Add rule")}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setForm(empty);
            }}
            className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover"
          >
            {t("Cancel")}
          </button>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="text-muted">{t("Try a description")}</span>
          <input value={test} onChange={(e) => setTest(e.target.value)} placeholder="NETFLIX.COM 866-579-7172" className={`${field} min-w-0 flex-1`} />
        </label>
        {test.trim() && (
          <span className="text-sm" role="status">
            {tested?.rule ? t("→ {category}", { category: tested.rule.category }) : t("No rule matches")}
          </span>
        )}
      </div>
      {!!data?.pending && (
        <button type="button" onClick={apply} className="self-start rounded-full bg-chip px-4 py-1.5 text-sm hover:bg-hover">
          {t("Apply to uncategorised transactions ({n})", { n: data.pending })}
        </button>
      )}
      {applied !== undefined && <p className="text-sm text-muted">{t("{n} transactions categorised.", { n: applied })}</p>}
    </section>
  );
}
