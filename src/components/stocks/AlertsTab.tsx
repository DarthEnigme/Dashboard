"use client";

import { useState } from "react";
import useSWR from "swr";
import { BellOff, BellRing, Pencil, Plus, X } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { ALERT_RULES, ALERT_KINDS, alertOp, alertOps, type AlertKind, type AlertRule } from "@/lib/stocks/alerts";
import { alertChannels } from "../settings/sections";
import type { Portfolio } from "@/lib/stocks/types";
import { number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Dialog, useDialogRun } from "../edit/Dialog";
import { DeleteButton, IconButton } from "../edit/controls";
import { inputClass, labelClass as field } from "../edit/FieldInput";
import { PortfolioSelect } from "./parts";
import { SymbolIcon } from "./SymbolIcon";
import { SymbolSearch } from "./SymbolSearch";

const URL = "/api/stocks/alerts";
interface AlertsData {
  alerts: AlertRule[];
  /** Alert channels set up in the settings. */
  channels: string[];
}

/** What the threshold is counted in. */
const unit = (kind: AlertKind, op: string) => alertOp(kind, op)?.unit ?? "amount";
const CHANNEL_NAMES: Record<string, string> = Object.fromEntries(alertChannels.map((c) => [c.id, c.label]));

/** A rule in words, in the reader's language. */
function Sentence({ rule, portfolios }: { rule: AlertRule; portfolios: Portfolio[] }) {
  const t = useT();
  const u = unit(rule.kind, rule.op);
  const value = u === "%" ? `${number(rule.value)} %` : u === "days" ? t.plural(rule.value, "{n} day", "{n} days") : number(rule.value);
  const subject = rule.kind === "portfolio" ? (portfolios.find((p) => p.id === rule.portfolio_id)?.name ?? t("All portfolios")) : rule.kind === "position" ? t("{symbol} position", { symbol: rule.symbol ?? "" }) : rule.symbol;
  return (
    <span>
      <span className="font-semibold">{subject}</span> {t(alertOp(rule.kind, rule.op)?.label ?? rule.op)} <span className="tabular-nums">{value}</span>
    </span>
  );
}

/** Rules that tell the alert channels when a price, a position, a portfolio or a company's calendar reaches what you set. */
export function AlertsTab({ portfolios, preset }: { portfolios: Portfolio[]; preset?: string }) {
  const t = useT();
  const { data, mutate, error } = useSWR<AlertsData>(URL, fetcher);
  const [editing, setEditing] = useState<AlertRule | { symbol?: string } | undefined>(preset ? { symbol: preset } : undefined);
  const [failure, setFailure] = useState<string>();
  const change = async (work: Promise<AlertsData>) => {
    setFailure(undefined);
    try {
      await mutate(work, { revalidate: false });
    } catch (e) {
      setFailure((e as Error).message);
    }
  };
  const problem = failure ?? (error as Error | undefined)?.message;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t("Each alert tells the channels once when it starts to hold, and again only after it stopped holding.")}</p>
        <button type="button" onClick={() => setEditing({})} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("New alert")}
        </button>
      </div>
      {data && !data.channels.length && (
        <p role="status" className="rounded-xl bg-[var(--warn)]/15 px-3 py-2 text-sm text-[var(--warn)]">
          {t("No alert channel is set up: alerts are kept but can't be sent. An admin sets channels up in the settings (Monitoring & alerts).")}
        </p>
      )}
      {problem && <p role="alert" className="text-sm text-[var(--err)]">{problem}</p>}
      {data?.alerts.length === 0 && <p className="glass rounded-3xl p-8 text-center text-muted">{t("No alerts yet.")}</p>}
      {data && data.alerts.length > 0 && (
        <ul className="glass flex flex-col rounded-3xl p-2">
          {data.alerts.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-hover ${a.active ? "" : "opacity-55"}`}>
              {a.symbol ? <SymbolIcon symbol={a.symbol} /> : <BellRing className="h-7 w-7 p-1 text-accent" />}
              <div className="min-w-0 flex-1 text-sm">
                <Sentence rule={a} portfolios={portfolios} />
                <div className="text-xs text-muted">
                  {t(ALERT_RULES[a.kind].label)} · {a.channels.length ? a.channels.map((c) => CHANNEL_NAMES[c] ?? c).join(", ") : t("all channels")}
                  {a.fired_at && ` · ${t("last sent {date}", { date: new Date(a.fired_at).toLocaleString() })}`}
                  {a.note && ` · ${a.note}`}
                </div>
              </div>
              <IconButton label={a.active ? "Pause alert" : "Resume alert"} onClick={() => void change(sendJson(URL, "PATCH", { ...a, portfolio: a.portfolio_id, active: !a.active }))}>
                {a.active ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              </IconButton>
              <IconButton label="Edit alert" onClick={() => setEditing(a)}>
                <Pencil className="h-4 w-4" />
              </IconButton>
              <DeleteButton label={t("Delete alert")} onConfirm={() => void change(sendJson(`${URL}?id=${a.id}`, "DELETE"))} />
            </li>
          ))}
        </ul>
      )}
      {editing && data && <AlertDialog rule={editing} portfolios={portfolios} channels={data.channels} onSave={(body) => mutate(sendJson<AlertsData>(URL, "id" in editing ? "PATCH" : "POST", body), { revalidate: false }).then(() => {})} onClose={() => setEditing(undefined)} />}
    </>
  );
}


function AlertDialog({ rule, portfolios, channels, onSave, onClose }: { rule: AlertRule | { symbol?: string }; portfolios: Portfolio[]; channels: string[]; onSave: (body: unknown) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const existing = "id" in rule ? rule : undefined;
  const [kind, setKind] = useState<AlertKind>(existing?.kind ?? "price");
  const [op, setOp] = useState<string>(existing?.op ?? alertOps(existing?.kind ?? "price")[0]);
  const [symbol, setSymbol] = useState(rule.symbol ?? "");
  const [portfolio, setPortfolio] = useState<number | null>(existing?.portfolio_id ?? null);
  const [value, setValue] = useState(existing ? String(existing.value) : "");
  const [chosen, setChosen] = useState<string[]>(existing?.channels ?? []);
  const [note, setNote] = useState(existing?.note ?? "");
  const { run, busy, error } = useDialogRun(onClose);
  const u = unit(kind, op);
  const save = () => run(() => onSave({ id: existing?.id, kind, op, symbol, portfolio, value: Number(value.replace(",", ".")), channels: chosen, note, active: existing?.active ?? true }));

  return (
    <Dialog title={existing ? t("Edit alert") : t("New alert")} onClose={onClose} onSubmit={save} error={error} busy={busy}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}>
          {t("Watch for")}
          <select
            value={kind}
            onChange={(e) => {
              const k = e.target.value as AlertKind;
              setKind(k);
              setOp(alertOps(k)[0]);
            }}
            className={inputClass}
          >
            {ALERT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(ALERT_RULES[k].label)}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          {t("When it")}
          <select value={op} onChange={(e) => setOp(e.target.value)} className={inputClass}>
            {alertOps(kind).map((o) => (
              <option key={o} value={o}>
                {t(alertOp(kind, o)?.label ?? o)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {ALERT_RULES[kind].symbol && (
        <div className={field}>
          {t("Symbol")}
          {symbol ? (
            <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-fg">
              <SymbolIcon symbol={symbol} size={22} />
              <span className="flex-1 font-semibold">{symbol}</span>
              <button type="button" onClick={() => setSymbol("")} aria-label={t("Change symbol")} className="text-muted hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <SymbolSearch autoFocus onPick={(hit) => setSymbol(hit.symbol)} />
          )}
        </div>
      )}
      {ALERT_RULES[kind].needs === "portfolio" && (
        <label className={field}>
          {t("Portfolio")}
          <PortfolioSelect portfolios={portfolios} value={portfolio} onChange={setPortfolio} all={t("All portfolios")} className={inputClass} />
        </label>
      )}
      <label className={field}>
        {u === "%" ? t("Threshold (%)") : u === "days" ? t("Days ahead") : kind === "portfolio" ? t("Amount (the portfolio's currency)") : t("Price (the symbol's currency)")}
        <input required inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />
      </label>
      {channels.length > 1 && (
        <fieldset className={field}>
          <legend className="mb-1.5">{t("Send to (none ticked: all channels)")}</legend>
          <div className="flex flex-wrap gap-3 text-sm font-normal text-fg">
            {channels.map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input type="checkbox" checked={chosen.includes(c)} onChange={(e) => setChosen(e.target.checked ? [...chosen, c] : chosen.filter((x) => x !== c))} />
                {CHANNEL_NAMES[c] ?? c}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className={field}>
        {t("Note (sent with it)")}
        <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Sell half, rebalance…")} className={inputClass} />
      </label>
    </Dialog>
  );
}
