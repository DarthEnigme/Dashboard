"use client";

import { useState } from "react";
import useSWR from "swr";
import { FileSpreadsheet, Pencil, PenLine, RefreshCw } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { money } from "@/lib/finance/format";
import type { Transaction } from "@/lib/finance/store";
import type { FieldSpec } from "@/integrations/fields";
import { FieldsDialog } from "../edit/FieldsDialog";
import { DeleteButton, IconButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";

const editFields: FieldSpec[] = [
  { key: "date", label: "Date (YYYY-MM-DD)", required: true },
  { key: "description", label: "Description", required: true },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount (negative = expense)", kind: "number", required: true },
];

const sourceIcon = { manual: PenLine, csv: FileSpreadsheet, firefly: RefreshCw } as const;

export function TransactionList({ period, currency, onChanged }: { period: string; currency: string; onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>();
  const [editing, setEditing] = useState<Transaction>();
  const params = new URLSearchParams({ period, ...(q ? { q } : {}), ...(category !== undefined ? { category } : {}) });
  const { data, error } = useSWR<Transaction[]>(`/api/finance/transactions?${params}`, fetcher, { keepPreviousData: true });
  const { data: categories } = useSWR<{ name: string; slot: number | null }[]>("/api/finance/categories", fetcher);
  const slotOf = new Map(categories?.map((c) => [c.name.toLowerCase(), c.slot]));

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
                <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => {
                const Src = sourceIcon[t.source] ?? PenLine;
                const slot = t.category ? slotOf.get(t.category.toLowerCase()) : undefined;
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
                          <span className="h-2 w-2 rounded-[2px]" style={{ background: slot ? `var(--series-${slot})` : "var(--fg-muted)" }} />
                          {t.category}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">–</span>
                      )}
                    </td>
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
          fields={editFields}
          initial={{ date: editing.date, description: editing.description, category: editing.category ?? "", amount: editing.amount_cents / 100 }}
          onClose={() => setEditing(undefined)}
          onSave={async (v) => {
            await sendJson(`/api/finance/transactions/${editing.id}`, "PATCH", { ...v, category: v.category || null });
            onChanged();
          }}
        />
      )}
    </section>
  );
}
