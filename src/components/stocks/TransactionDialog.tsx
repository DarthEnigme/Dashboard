"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { sendJson } from "@/lib/fetcher";
import { localDay } from "@/lib/day";
import { TRADE_KINDS, type Portfolio, type TradeKind, type Transaction } from "@/lib/stocks/types";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { Dialog, useDialogRun } from "../edit/Dialog";
import { DeleteButton } from "../edit/controls";
import { inputClass, labelClass as label } from "../edit/FieldInput";
import { PortfolioSelect } from "./parts";
import { SymbolSearch } from "./SymbolSearch";

const KIND_LABELS: Record<TradeKind, string> = { buy: msg("Buy"), sell: msg("Sell") };

interface Props {
  /** The transaction to edit, or what a new one starts with. */
  transaction: Transaction | { portfolio_id: number; symbol?: string };
  portfolios: Portfolio[];
  /** After a save or a delete: the figures have changed. */
  onSaved: () => void;
  onClose: () => void;
}

/** A buy or a sell: what, when, how many, at what price. */
export function TransactionDialog({ transaction, portfolios, onSaved, onClose }: Props) {
  const t = useT();
  const existing = "id" in transaction ? transaction : undefined;
  const [draft, setDraft] = useState({
    portfolio: transaction.portfolio_id,
    symbol: transaction.symbol ?? "",
    name: "",
    kind: existing?.kind ?? ("buy" as TradeKind),
    date: existing?.date ?? localDay(),
    quantity: existing ? String(existing.quantity) : "",
    price: existing ? String(existing.price) : "",
    fees: existing?.fees ? String(existing.fees) : "",
    note: existing?.note ?? "",
  });
  const { run, busy, error, setError } = useDialogRun(() => {
    onSaved();
    onClose();
  });
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () => {
    if (!draft.symbol) return setError(t("Pick what you bought or sold"));
    void run(() => sendJson("/api/stocks/transactions", existing ? "PATCH" : "POST", { ...draft, id: existing?.id }));
  };

  return (
    <Dialog title={existing ? t("Edit transaction") : t("New transaction")} onClose={onClose} onSubmit={save} error={error} busy={busy}>
      {draft.symbol ? (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-chip px-3 py-2 text-sm">
          <span className="font-semibold">{draft.symbol}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{draft.name}</span>
          <button type="button" onClick={() => setDraft((d) => ({ ...d, symbol: "", name: "" }))} aria-label={t("Choose another")} title={t("Choose another")} className="rounded-full p-1 text-muted hover:bg-hover hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <SymbolSearch autoFocus onPick={(hit) => setDraft((d) => ({ ...d, symbol: hit.symbol, name: hit.name }))} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={label}>
          {t("Type")}
          <div className="flex gap-1 rounded-xl border border-line p-1" role="group" aria-label={t("Type")}>
            {TRADE_KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={draft.kind === k} onClick={() => set("kind", k)} className="flex-1 rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg aria-pressed:bg-accent aria-pressed:text-white">
                {t(KIND_LABELS[k])}
              </button>
            ))}
          </div>
        </div>
        <label className={label}>
          {t("Date")}
          <input type="date" required max={localDay()} value={draft.date} onChange={(e) => set("date", e.target.value)} className={inputClass} />
        </label>
        <label className={label}>
          {t("Shares")}
          <input inputMode="decimal" required value={draft.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="10" className={inputClass} />
        </label>
        <label className={label}>
          {t("Price per share (in the share's currency)")}
          <input inputMode="decimal" required value={draft.price} onChange={(e) => set("price", e.target.value)} placeholder="123.45" className={inputClass} />
        </label>
        <label className={label}>
          {t("Fees (optional)")}
          <input inputMode="decimal" value={draft.fees} onChange={(e) => set("fees", e.target.value)} placeholder="0" className={inputClass} />
        </label>
        <label className={label}>
          {t("Portfolio")}
          <PortfolioSelect portfolios={portfolios} value={draft.portfolio} onChange={(id) => id && set("portfolio", id)} className={inputClass} />
        </label>
      </div>
      <label className={label}>
        {t("Note (optional)")}
        <input maxLength={200} value={draft.note} onChange={(e) => set("note", e.target.value)} className={inputClass} />
      </label>
      {existing && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <DeleteButton label={t("Delete transaction")} onConfirm={() => void run(() => sendJson(`/api/stocks/transactions?id=${existing.id}`, "DELETE"))} />
          {t("Delete this transaction")}
        </div>
      )}
    </Dialog>
  );
}
