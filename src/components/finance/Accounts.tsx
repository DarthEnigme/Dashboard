"use client";

import { useState } from "react";
import useSWR from "swr";
import { Archive, ArchiveRestore, ArrowLeftRight, Banknote, CreditCard, Landmark, Pencil, PiggyBank, Plus, Wallet } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { money } from "@/lib/finance/format";
import type { AccountWithBalance } from "@/lib/finance/accounts";
import type { FieldSpec } from "@/integrations/fields";
import { FieldsDialog, getPath, setPath } from "../edit/FieldsDialog";
import { DeleteButton, IconButton } from "../edit/controls";
import { Dialog } from "../edit/Dialog";
import { FieldInput, type FormValue } from "../edit/FieldInput";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n";

export const ACCOUNTS_KEY = "/api/finance/accounts";
const KINDS = ["bank", "cash", "card", "savings", "other"];
const kindIcon = { bank: Landmark, cash: Banknote, card: CreditCard, savings: PiggyBank, other: Wallet } as const;

const accountFields = (currency: string): FieldSpec[] => [
  { key: "name", label: msg("Name"), required: true, placeholder: msg("Checking, Wallet, Visa…") },
  { key: "kind", label: msg("Kind"), kind: "select", options: KINDS, required: true },
  { key: "currency", label: msg("Currency"), placeholder: currency, help: msg("Three letters, e.g. EUR.") },
  { key: "opening", label: msg("Opening balance"), kind: "number", placeholder: "0", help: msg("What the account held before its first transaction here.") },
];

/**
 * Accounts (bank, cash, card…) with their balances, built from the transactions that name them.
 * Transfers between them change balances but are never income or spending.
 */
export function Accounts({ currency, selected, onSelect, onChanged }: { currency: string; selected?: string; onSelect: (name?: string) => void; onChanged: () => void }) {
  const t = useT();
  const { data: accounts, mutate } = useSWR<AccountWithBalance[]>(ACCOUNTS_KEY, fetcher);
  const [editing, setEditing] = useState<AccountWithBalance | "new">();
  const [moving, setMoving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string>();
  const shown = accounts?.filter((a) => showArchived || !a.archived) ?? [];
  const archived = accounts?.filter((a) => a.archived).length ?? 0;

  const act = async (fn: () => Promise<AccountWithBalance[]>) => {
    setError(undefined);
    try {
      await mutate(await fn(), { revalidate: false });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Net worth in each currency that accounts use.
  const totals = new Map<string, number>();
  for (const a of accounts ?? []) if (!a.archived) totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balance);

  return (
    <section className="flex flex-col gap-3" aria-label={t("Accounts")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm text-muted">
          {[...totals].map(([c, cents]) => (
            <span key={c} className="mr-3">
              {t("Total")}{" "}<span className="font-semibold text-fg tabular-nums">{money(cents, c)}</span>
            </span>
          ))}
        </div>
        {archived > 0 && (
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
            {showArchived ? t("Hide archived") : t("Show archived ({n})", { n: archived })}
          </button>
        )}
        <button
          type="button"
          disabled={(accounts?.filter((a) => !a.archived).length ?? 0) < 2}
          onClick={() => setMoving(true)}
          title={t("Move money between two of your accounts")}
          className="flex items-center gap-1.5 rounded-full bg-track px-4 py-2 text-sm hover:bg-hover disabled:opacity-50"
        >
          <ArrowLeftRight className="h-4 w-4" /> {t("Transfer")}
        </button>
        <button type="button" onClick={() => setEditing("new")} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("Add account")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--err)]">
          {error}
        </p>
      )}
      {accounts && !accounts.length && (
        <p className="glass rounded-3xl p-8 text-center text-sm text-muted">
          {t("No accounts yet. Add your bank account, wallet or card to see a balance per account. Accounts named by Firefly III or a CSV import appear here by themselves.")}
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((a) => {
          const Icon = kindIcon[a.kind] ?? Wallet;
          const active = selected?.toLowerCase() === a.name.toLowerCase();
          return (
            <li key={a.id} data-account={a.name} className={`glass flex flex-col gap-2 rounded-3xl p-4 ${a.archived ? "opacity-60" : ""} ${active ? "ring-2 ring-accent" : ""}`}>
              <div className="flex items-start gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-chip text-accent">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <button type="button" onClick={() => onSelect(active ? undefined : a.name)} className="mr-auto min-w-0 text-left" title={active ? t("Show all accounts") : t("Only {name}", { name: a.name })}>
                  <span className="block truncate font-semibold">{a.name}</span>
                  <span className="block text-xs text-muted">
                    <span className="capitalize">{t(a.kind)}</span> · {t.plural(a.transactions, "{n} transaction", "{n} transactions")}
                    {a.archived ? t(" · archived") : ""}
                  </span>
                </button>
                <IconButton label={t("Edit {name}", { name: a.name })} onClick={() => setEditing(a)}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label={a.archived ? t("Restore {name}", { name: a.name }) : t("Archive {name}", { name: a.name })} onClick={() => act(() => sendJson(ACCOUNTS_KEY, "PATCH", { id: a.id, archived: !a.archived }))}>
                  {a.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                </IconButton>
                {a.transactions === 0 && <DeleteButton label={t("Delete {name}", { name: a.name })} onConfirm={() => act(() => sendJson(`${ACCOUNTS_KEY}?id=${a.id}`, "DELETE"))} />}
              </div>
              <div className={`text-2xl font-semibold tabular-nums ${a.balance < 0 ? "text-[var(--err)]" : ""}`} aria-label={t("{name} balance", { name: a.name })}>
                {money(a.balance, a.currency)}
              </div>
              <BalanceLine history={a.history} label={t("{name} balance over 12 months", { name: a.name })} />
              {a.skipped > 0 && <p className="text-xs text-[var(--warn)]">{a.skipped} {t("in another currency without a rate, left out.")}</p>}
            </li>
          );
        })}
      </ul>

      {editing && (
        <FieldsDialog
          title={editing === "new" ? t("Add account") : t("Edit {name}", { name: editing.name })}
          fields={accountFields(currency)}
          initial={
            editing === "new"
              ? { kind: "bank", currency }
              : { name: editing.name, kind: editing.kind, currency: editing.currency, opening: editing.opening_cents / 100 }
          }
          onClose={() => setEditing(undefined)}
          onSave={async (v) => {
            const list = await sendJson<AccountWithBalance[]>(ACCOUNTS_KEY, editing === "new" ? "POST" : "PATCH", { ...(editing === "new" ? {} : { id: editing.id }), ...v });
            await mutate(list, { revalidate: false });
            onChanged();
          }}
        />
      )}
      {moving && accounts && (
        <TransferDialog
          accounts={accounts.filter((a) => !a.archived)}
          onClose={() => setMoving(false)}
          onDone={async () => {
            await mutate();
            onChanged();
          }}
        />
      )}
    </section>
  );
}

/** The balance at each month end; a dashed line marks zero when the account went negative. */
function BalanceLine({ history, label }: { history: { month: string; cents: number }[]; label: string }) {
  const values = history.map((h) => h.cents);
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 0);
  const span = hi - lo || 1;
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * 100 : 50);
  const y = (v: number) => 2 + 32 * (1 - (v - lo) / span);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="h-9 w-full" role="img" aria-label={label}>
      {lo < 0 && <line x1="0" x2="100" y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      <path d={`${line} L100,36 L0,36 Z`} fill="color-mix(in oklab, var(--accent) 16%, transparent)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function TransferDialog({ accounts, onClose, onDone }: { accounts: AccountWithBalance[]; onClose: () => void; onDone: () => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState<Record<string, unknown>>({ from: accounts[0].name, to: accounts[1].name, date: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const from = accounts.find((a) => a.name === value.from) ?? accounts[0];
  const to = accounts.find((a) => a.name === value.to) ?? accounts[1];
  const names = accounts.map((a) => a.name);
  const fields: FieldSpec[] = [
    { key: "from", label: msg("From"), kind: "select", options: names, required: true },
    { key: "to", label: msg("To"), kind: "select", options: names, required: true },
    { key: "date", label: t("Date (YYYY-MM-DD)"), required: true },
    { key: "amount", label: t("Amount ({currency})", { currency: from.currency }), kind: "number", required: true },
    ...(from.currency !== to.currency ? [{ key: "toAmount", label: t("Received ({currency})", { currency: to.currency }), kind: "number" as const, required: true }] : []),
    { key: "note", label: msg("Note"), placeholder: t("Transfer to {name}", { name: to.name }) },
  ];
  const submit = async () => {
    const missing = fields.find((f) => f.required && (getPath(value, f.key) ?? "") === "");
    if (missing) return setError(t("{field} is required", { field: t(missing.label) }));
    setBusy(true);
    try {
      await sendJson("/api/finance/transfer", "POST", { ...value, from: from.id, to: to.id });
      await onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t("Transfer between accounts")} submitLabel={t("Transfer")} onClose={onClose} onSubmit={() => void submit()} error={error} busy={busy}>
      {fields.map((f, i) => (
        <FieldInput key={f.key} spec={f} autoFocus={i === 0} value={getPath(value, f.key) as FormValue} onChange={(v) => setValue((cur) => setPath(cur, f.key, v))} />
      ))}
    </Dialog>
  );
}
