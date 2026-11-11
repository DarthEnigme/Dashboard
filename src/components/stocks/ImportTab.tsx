"use client";

import { useState } from "react";
import useSWR from "swr";
import { Download, PlugZap, RefreshCw, Upload } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Prepared } from "@/lib/stocks/import";
import type { Connection } from "@/lib/stocks/brokers/sync";
import type { Portfolio } from "@/lib/stocks/types";
import { msg } from "@/i18n";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { asLocal } from "@/lib/day";
import { DeleteButton } from "../edit/controls";
import { inputBase, inputClass } from "../edit/FieldInput";
import { Dialog } from "../edit/Dialog";
import { quoted, shares } from "./format";
import { Card } from "./parts";
import { SymbolIcon } from "./SymbolIcon";

const BROKERS_URL = "/api/stocks/brokers";
const EXPORTS = [
  { what: "transactions", label: msg("Transactions") },
  { what: "positions", label: msg("Positions") },
  { what: "dividends", label: msg("Dividends") },
] as const;

/** Trades from a broker's file or its API, and the portfolio's numbers out to a spreadsheet. */
export function ImportTab({ portfolios, portfolio, onImported }: { portfolios: Portfolio[]; portfolio: number | null; onImported: () => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ImportCard portfolios={portfolios} start={portfolio ?? portfolios[0].id} onImported={onImported} />
      <div className="flex flex-col gap-6">
        <BrokersCard portfolios={portfolios} onSynced={onImported} />
        <ExportCard portfolio={portfolio} />
      </div>
    </div>
  );
}

function ImportCard({ portfolios, start, onImported }: { portfolios: Portfolio[]; start: number; onImported: () => void }) {
  const t = useT();
  const [file, setFile] = useState<File>();
  const [portfolio, setPortfolio] = useState(start);
  const [preset, setPreset] = useState("");
  const [preview, setPreview] = useState<Prepared>();
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const post = async <T,>(f: File, p: string, mode: "preview" | "save"): Promise<T> => {
    const form = new FormData();
    form.set("file", f);
    form.set("portfolio", String(portfolio));
    if (p) form.set("preset", p);
    const res = await fetch(`/api/stocks/import${mode === "preview" ? "?preview=1" : ""}`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body as T;
  };
  const look = async (f: File, p = preset) => {
    setFile(f);
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const prepared = await post<Prepared>(f, p, "preview");
      setPreview(prepared);
      setPreset(prepared.preset);
    } catch (e) {
      setError((e as Error).message);
      setPreview(undefined);
    }
    setBusy(false);
  };
  const save = async () => {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await post<{ added: number; skipped: number; unresolved: number }>(file, preset, "save");
      setResult(t("{added} added, {skipped} already there, {unresolved} without a symbol.", r));
      setPreview(undefined);
      setFile(undefined);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const ready = preview?.trades.filter((x) => x.yahoo && !x.duplicate).length ?? 0;

  return (
    <Card title={t("Import trades")}>
      <p className="text-sm text-muted">{t("A CSV or Excel export from Degiro, Trade Republic, Trading 212, Interactive Brokers, or NanoDash itself. Importing a file twice adds nothing.")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={portfolio} onChange={(e) => setPortfolio(Number(e.target.value))} aria-label={t("Into portfolio")} className={`${inputBase} w-44`}>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Upload className="h-4 w-4" /> {t("Choose a file")}
          <input type="file" accept=".csv,.txt,.xlsx,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void look(e.target.files[0])} />
        </label>
        {preview && (
          <select value={preset} onChange={(e) => file && void look(file, e.target.value)} aria-label={t("Format")} className={`${inputBase} w-52`}>
            {preview.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {busy && <p className="text-sm text-muted">{t("Reading the file and looking the symbols up…")}</p>}
      {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}
      {result && <p role="status" className="text-sm text-[var(--ok)]">{result}</p>}
      {preview && (
        <>
          {preview.errors.length > 0 && (
            <details className="text-xs text-[var(--warn)]">
              <summary>{t.plural(preview.errors.length, "{n} line couldn't be read", "{n} lines couldn't be read")}</summary>
              <ul className="mt-1 list-inside list-disc">
                {preview.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="-mx-2 max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: "var(--dialog)" }}>
                <tr className="text-left text-xs text-muted">
                  <th className="px-2 py-1 font-medium">{t("Date")}</th>
                  <th className="px-2 py-1 font-medium">{t("Symbol")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("Quantity")}</th>
                  <th className="px-2 py-1 text-right font-medium">{t("Price")}</th>
                  <th className="px-2 py-1 font-medium">{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.trades.map((x) => (
                  <tr key={x.externalId} className={`border-t border-line ${x.duplicate || !x.yahoo ? "opacity-55" : ""}`}>
                    <td className="px-2 py-1 tabular-nums">{dateOnly(asLocal(x.date))}</td>
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1.5">
                        {x.yahoo && <SymbolIcon symbol={x.yahoo} size={18} />}
                        <span className="font-medium">{x.yahoo ?? x.isin ?? x.symbol}</span>
                        <span className={x.kind === "buy" ? "text-[var(--ok)]" : "text-[var(--err)]"}>{x.kind === "buy" ? t("Buy") : t("Sell")}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{shares(x.quantity)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{x.quoted ? quoted(x.price, x.quoted) : x.price}</td>
                    <td className="px-2 py-1 text-xs">{x.duplicate ? t("already there") : x.problem ? <span className="text-[var(--warn)]">{x.problem}</span> : t("new")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <button type="button" disabled={!ready || busy} onClick={() => void save()} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">
              {t.plural(ready, "Add {n} trade", "Add {n} trades")}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

function BrokersCard({ portfolios, onSynced }: { portfolios: Portfolio[]; onSynced: () => void }) {
  const t = useT();
  // While a sync runs, look again every few seconds.
  const { data, mutate } = useSWR<Connection[]>(BROKERS_URL, fetcher, { refreshInterval: (d) => (d?.some((c) => c.syncing) ? 3000 : 0), onSuccess: (d) => d.some((c) => c.added) && onSynced() });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const act = (work: Promise<Connection[]>) => {
    setError(undefined);
    void mutate(work, { revalidate: false }).catch((e: Error) => setError(e.message));
  };
  const name = (id: number) => portfolios.find((p) => p.id === id)?.name ?? "";

  return (
    <Card
      title={t("Brokers")}
      action={
        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-accent hover:bg-hover">
          <PlugZap className="h-4 w-4" /> {t("Connect")}
        </button>
      }
    >
      <p className="text-sm text-muted">{t("Trading 212 and Interactive Brokers send their trades on their own, every six hours. For Degiro and Trade Republic, import their export file.")}</p>
      {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}
      {data?.length === 0 && <p className="text-sm text-muted">{t("No broker connected.")}</p>}
      <ul className="flex flex-col gap-2">
        {data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {c.label} → {name(c.portfolio_id)}
              </div>
              <div className={`text-xs ${c.error ? "text-[var(--err)]" : "text-muted"}`}>
                {c.syncing ? t("Syncing…") : c.error ? c.error : c.synced_at ? t("Synced {date}", { date: new Date(c.synced_at).toLocaleString() }) : t("Not synced yet")}
                {!c.syncing && c.added !== null && !c.error && ` · ${t.plural(c.added, "{n} new trade", "{n} new trades")}`}
              </div>
            </div>
            <button type="button" disabled={c.syncing} onClick={() => act(sendJson(BROKERS_URL, "PATCH", { id: c.id }))} aria-label={t("Sync {broker} now", { broker: c.label })} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg disabled:opacity-40">
              <RefreshCw className={`h-4 w-4 ${c.syncing ? "animate-spin" : ""}`} />
            </button>
            <DeleteButton label={t("Disconnect {broker}", { broker: c.label })} onConfirm={() => act(sendJson(`${BROKERS_URL}?id=${c.id}`, "DELETE"))} />
          </li>
        ))}
      </ul>
      {adding && <ConnectDialog portfolios={portfolios} onSave={(body) => mutate(sendJson<Connection[]>(BROKERS_URL, "POST", body), { revalidate: false }).then(() => {})} onClose={() => setAdding(false)} />}
    </Card>
  );
}

const field = "flex flex-col gap-1.5 text-xs font-medium text-muted";

function ConnectDialog({ portfolios, onSave, onClose }: { portfolios: Portfolio[]; onSave: (body: unknown) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<"t212" | "ibkr">("t212");
  const [portfolio, setPortfolio] = useState(portfolios[0].id);
  const [secret, setSecret] = useState("");
  const [account, setAccount] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ kind, portfolio, secret, account });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={t("Connect a broker")} onClose={onClose} onSubmit={save} error={error} busy={busy}>
      <label className={field}>
        {t("Broker")}
        <select value={kind} onChange={(e) => setKind(e.target.value as "t212" | "ibkr")} className={inputClass}>
          <option value="t212">Trading 212</option>
          <option value="ibkr">Interactive Brokers</option>
        </select>
      </label>
      <label className={field}>
        {t("Into portfolio")}
        <select value={portfolio} onChange={(e) => setPortfolio(Number(e.target.value))} className={inputClass}>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        {kind === "t212" ? t("API key (or key:secret)") : t("Flex Web Service token")}
        <input required type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className={inputClass} />
      </label>
      {kind === "ibkr" && (
        <label className={field}>
          {t("Flex query id")}
          <input required value={account} onChange={(e) => setAccount(e.target.value)} placeholder="123456" className={inputClass} />
        </label>
      )}
      <p className="text-xs text-muted">
        {kind === "t212"
          ? t("In Trading 212: Settings → API (Beta) → generate a key with permission to read history. Read-only is enough.")
          : t("In the IBKR Client Portal: Performance & Reports → Flex Queries → a Trade Confirmation or Activity query with Trades, then Flex Web Service → token.")}{" "}
        {t("The key is stored encrypted and never shown again.")}
      </p>
    </Dialog>
  );
}

function ExportCard({ portfolio }: { portfolio: number | null }) {
  const t = useT();
  const href = (what: string, format: string) => `/api/stocks/export?${new URLSearchParams({ what, format, ...(portfolio ? { portfolio: String(portfolio) } : {}) })}`;
  return (
    <Card title={t("Export")}>
      <p className="text-sm text-muted">{t("The transactions import back as they are. Company figures of any symbols export from Compare.")}</p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {EXPORTS.map((e) => (
          <li key={e.what} className="flex items-center gap-2">
            <Download className="h-4 w-4 text-muted" />
            <span className="min-w-28">{t(e.label)}</span>
            {["csv", "xlsx", "json"].map((f) => (
              <a key={f} href={href(e.what, f)} download className="rounded-full px-2.5 py-0.5 text-accent hover:bg-hover">
                {f.toUpperCase()}
              </a>
            ))}
          </li>
        ))}
      </ul>
    </Card>
  );
}
