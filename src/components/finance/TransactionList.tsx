"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowLeftRight, Download, FileSpreadsheet, Pencil, PenLine, RefreshCw, Repeat } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { categoryColor, money } from "@/lib/finance/format";
import type { Transaction } from "@/lib/finance/store";
import type { Account } from "@/lib/finance/accounts";
import type { FieldSpec } from "@/integrations/fields";
import { FieldsDialog } from "../edit/FieldsDialog";
import { DeleteButton, IconButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";

const editFields = (accounts: string[]): FieldSpec[] => [
  { key: "date", label: "Date (YYYY-MM-DD)", required: true },
  { key: "description", label: "Description", required: true },
  { key: "category", label: "Category" },
  ...(accounts.length ? [{ key: "account", label: "Account", kind: "select" as const, options: accounts, placeholder: "No account" }] : []),
  { key: "amount", label: "Amount (negative = expense)", kind: "number", required: true },
];

const sourceIcon = { manual: PenLine, csv: FileSpreadsheet, firefly: RefreshCw, recurring: Repeat, transfer: ArrowLeftRight } as const;

export function TransactionList({
  period,
  currency,
  account,
  accounts = [],
  onChanged,
}: {
  period: string;
  currency: string;
  /** Only this account ("" = none); undefined = all. */
  account?: string;
  accounts?: Account[];
  onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>();
  const [editing, setEditing] = useState<Transaction>();
  const params = new URLSearchParams({ period, ...(q ? { q } : {}), ...(category !== undefined ? { category } : {}), ...(account !== undefined ? { account } : {}) });
  const showAccount = accounts.length > 0 && account === undefined;
  const { data, error } = useSWR<Transaction[]>(`/api/finance/transactions?${params}`, fetcher, { keepPreviousData: true });
  const { data: categories } = useSWR<{ name: string; slot: number | null; color: string | null }[]>("/api/finance/categories", fetcher);
  const colorOf = new Map(categories?.map((c) => [c.name.toLowerCase(), categoryColor(c.slot, c.color)]));

  return (
    <section className="glass flex flex-col gap-3 rounded-3xl p-4">
      <div className="flex flex-wrap gap-2">
        <input aria-label="Search transactions" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className={`${inputBase} max-w-xs`} />
        <select
          aria-label="Filter by category"
          value={category ?? "*"}
          onChange={(e) => setCategory(e.target.value === "*" ? undefined : e.target.value)}
          className={`${inputBase} w-48`}
        >
          <option value="*">All categories</option>
          <option value="">Uncategorised</option>
          {categories?.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="ml-auto flex flex-wrap gap-1 text-sm">
          <a href={`/api/finance/export?${params}`} download className="flex h-10 items-center gap-1.5 rounded-xl px-3 hover:bg-hover" title="This period, with the filters above">
            <Download className="h-4 w-4" /> Export CSV
          </a>
          <a href="/api/finance/export" download className="flex h-10 items-center rounded-xl px-3 text-muted hover:bg-hover hover:text-fg" title="Every transaction, as CSV">
            All
          </a>
          <a href={`/api/finance/export?${params}&format=json`} download className="flex h-10 items-center rounded-xl px-3 text-muted hover:bg-hover hover:text-fg" title="This period as JSON">
            JSON
          </a>
        </div>
      </div>
      {error && <p className="text-sm text-[var(--err)]">{error.message}</p>}
      {data?.length === 0 && <p className="py-8 text-center text-sm text-muted">No transactions in this period.</p>}
      {!!data?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-2 py-1.5 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Description</th>
                <th className="px-2 py-1.5 font-medium">Category</th>
                {showAccount && <th className="px-2 py-1.5 font-medium">Account</th>}
                <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => {
                const Src = sourceIcon[t.source] ?? PenLine;
                const color = (t.category && colorOf.get(t.category.toLowerCase())) || categoryColor(null);
                return (
                  <tr key={t.id} className="border-t border-line/50">
                    <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-muted">{t.date}</td>
                    <td className="max-w-80 truncate px-2 py-1.5">
                      <span className="flex items-center gap-2">
                        <Src className="h-3.5 w-3.5 shrink-0 text-muted" aria-label={`Source: ${t.source}`} />
                        {t.description}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      {t.category ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-chip px-2 py-0.5 text-xs">
                          <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
                          {t.category}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">–</span>
                      )}
                    </td>
                    {showAccount && <td className="max-w-40 truncate px-2 py-1.5 text-xs text-muted">{t.account ?? "–"}</td>}
                    <td className={`px-2 py-1.5 text-right whitespace-nowrap tabular-nums ${t.amount_cents > 0 ? "text-[var(--ok)]" : ""}`}>
                      {money(t.amount_cents, t.currency || currency, true)}
                    </td>
                    <td className="px-1 py-1 text-right whitespace-nowrap">
                      <IconButton label="Edit transaction" onClick={() => setEditing(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <DeleteButton
                        label="Delete transaction"
                        onConfirm={async () => {
                          await sendJson(`/api/finance/transactions/${t.id}`, "DELETE");
                          onChanged();
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <FieldsDialog
          title="Edit transaction"
          fields={editFields(accounts.map((a) => a.name))}
          initial={{ date: editing.date, description: editing.description, category: editing.category ?? "", account: editing.account ?? "", amount: editing.amount_cents / 100 }}
          onClose={() => setEditing(undefined)}
          onSave={async (v) => {
            await sendJson(`/api/finance/transactions/${editing.id}`, "PATCH", { ...v, category: v.category || null, ...(accounts.length ? { account: v.account || null } : {}) });
            onChanged();
          }}
        />
      )}
    </section>
  );
}
