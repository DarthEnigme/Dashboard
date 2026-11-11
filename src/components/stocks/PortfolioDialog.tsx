"use client";

import { useState } from "react";
import { sendJson } from "@/lib/fetcher";
import type { Portfolio, PortfolioList } from "@/lib/stocks/types";
import { useT } from "@/i18n/client";
import { Dialog } from "../edit/Dialog";
import { DeleteButton } from "../edit/controls";
import { inputClass } from "../edit/FieldInput";

interface PortfolioDialogProps {
  portfolio?: Portfolio;
  canDelete: boolean;
  onSaved: (list: PortfolioList, removed: boolean) => void;
  onClose: () => void;
}

/** Names a portfolio and the currency its totals are shown in; deletes it when another one is left. */
export function PortfolioDialog({ portfolio, canDelete, onSaved, onClose }: PortfolioDialogProps) {
  const t = useT();
  const [name, setName] = useState(portfolio?.name ?? "");
  const [currency, setCurrency] = useState(portfolio?.currency ?? "EUR");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<PortfolioList>, removed = false) => {
    setBusy(true);
    try {
      onSaved(await work(), removed);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={portfolio ? t("Edit portfolio") : t("New portfolio")} onClose={onClose} onSubmit={() => void run(() => sendJson<PortfolioList>("/api/stocks/portfolios", portfolio ? "PATCH" : "POST", { id: portfolio?.id, name, currency }))} error={error} busy={busy}>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
        {t("Name")}
        <input autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("PEA, brokerage account…")} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
        {t("Currency its totals are shown in")}
        <input required minLength={3} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="EUR" className={inputClass} />
      </label>
      {portfolio && canDelete && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <DeleteButton label={t("Delete portfolio")} onConfirm={() => void run(() => sendJson<PortfolioList>(`/api/stocks/portfolios?id=${portfolio.id}`, "DELETE"), true)} />
          {t("Delete this portfolio and its transactions")}
        </div>
      )}
    </Dialog>
  );
}
