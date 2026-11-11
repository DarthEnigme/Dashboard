"use client";

import { useState } from "react";
import useSWR from "swr";
import { BellOff, BellRing, Pencil, Plus, X } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { ALERT_RULES, ALERT_KINDS, type AlertKind, type AlertRule } from "@/lib/stocks/alerts";
import type { Portfolio } from "@/lib/stocks/types";
import { msg } from "@/i18n";
import { number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Dialog } from "../edit/Dialog";
import { DeleteButton, IconButton } from "../edit/controls";
import { inputClass } from "../edit/FieldInput";
import { SymbolIcon } from "./SymbolIcon";
import { SymbolSearch } from "./SymbolSearch";

const URL = "/api/stocks/alerts";
interface AlertsData {
  alerts: AlertRule[];
  /** Alert channels set up in the settings. */
  channels: string[];
}

const KIND_LABELS: Record<AlertKind, string> = { price: msg("Price"), move: msg("Daily move"), position: msg("Position"), portfolio: msg("Portfolio"), event: msg("Event") };
const OP_LABELS: Record<string, string> = {
  above: msg("goes above"),
  below: msg("goes below"),
  up: msg("rises by"),
  down: msg("falls by"),
  either: msg("moves by"),
  gain: msg("gains (target)"),
  loss: msg("loses (stop)"),
  dayUp: msg("rises in a day by"),
  dayDown: msg("falls in a day by"),
  earnings: msg("publishes results within"),
  exDividend: msg("goes ex-dividend within"),
};
/** What the threshold is counted in. */
const unit = (kind: AlertKind, op: string) => (kind === "event" ? "days" : kind === "move" || kind === "position" || op === "dayUp" || op === "dayDown" ? "%" : "amount");
const CHANNEL_NAMES: Record<string, string> = { discord: "Discord", webhook: "Webhook", gotify: "Gotify", ntfy: "ntfy", slack: "Slack", telegram: "Telegram", email: "Email", pushover: "Pushover", matrix: "Matrix" };

/** A rule in words, in the reader's language. */
function Sentence({ rule, portfolios }: { rule: AlertRule; portfolios: Portfolio[] }) {
  const t = useT();
  const u = unit(rule.kind, rule.op);
  const value = u === "%" ? `${number(rule.value)} %` : u === "days" ? t.plural(rule.value, "{n} day", "{n} days") : number(rule.value);
  const subject = rule.kind === "portfolio" ? (portfolios.find((p) => p.id === rule.portfolio_id)?.name ?? t("All portfolios")) : rule.kind === "position" ? t("{symbol} position", { symbol: rule.symbol ?? "" }) : rule.symbol;
  return (
    <span>
      <span className="font-semibold">{subject}</span> {t(OP_LABELS[rule.op] ?? rule.op)} <span className="tabular-nums">{value}</span>
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
                  {t(KIND_LABELS[a.kind])} · {a.channels.length ? a.channels.map((c) => CHANNEL_NAMES[c] ?? c).join(", ") : t("all channels")}
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

const field = "flex flex-col gap-1.5 text-xs font-medium text-muted";

function AlertDialog({ rule, portfolios, channels, onSave, onClose }: { rule: AlertRule | { symbol?: string }; portfolios: Portfolio[]; channels: string[]; onSave: (body: unknown) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const existing = "id" in rule ? rule : undefined;
  const [kind, setKind] = useState<AlertKind>(existing?.kind ?? "price");
  const [op, setOp] = useState<string>(existing?.op ?? ALERT_RULES[existing?.kind ?? "price"][0]);
  const [symbol, setSymbol] = useState(rule.symbol ?? "");
  const [portfolio, setPortfolio] = useState<number | null>(existing?.portfolio_id ?? null);
  const [value, setValue] = useState(existing ? String(existing.value) : "");
  const [chosen, setChosen] = useState<string[]>(existing?.channels ?? []);
  const [note, setNote] = useState(existing?.note ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const u = unit(kind, op);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSave({ id: existing?.id, kind, op, symbol, portfolio, value: Number(value.replace(",", ".")), channels: chosen, note, active: existing?.active ?? true });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

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
              setOp(ALERT_RULES[k][0]);
            }}
            className={inputClass}
          >
            {ALERT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(KIND_LABELS[k])}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          {t("When it")}
          <select value={op} onChange={(e) => setOp(e.target.value)} className={inputClass}>
            {ALERT_RULES[kind].map((o) => (
              <option key={o} value={o}>
                {t(OP_LABELS[o])}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind !== "portfolio" && (
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
      {(kind === "portfolio" || kind === "position") && (
        <label className={field}>
          {t("Portfolio")}
          <select value={portfolio ?? ""} onChange={(e) => setPortfolio(Number(e.target.value) || null)} className={inputClass}>
            <option value="">{t("All portfolios")}</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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
