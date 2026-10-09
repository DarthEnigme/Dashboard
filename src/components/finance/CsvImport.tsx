"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, RefreshCw, Upload } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { CsvMapping, ParsedTransaction } from "@/lib/finance/csv";
import type { Account } from "@/lib/finance/accounts";
import { money } from "@/lib/finance/format";
import { inputClass } from "../edit/FieldInput";
import { formatLocale } from "@/i18n/format";
import { useT } from "@/i18n/client";

type Step = { kind: "start" } | { kind: "map"; rows: string[][]; columns: number };

const PRESETS_KEY = "page:csv-mapping";

/** The file goes to the server as text (CSV) or base64 (Excel). */
type Source = { text: string } | { xlsx: string; name: string };

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const isExcel = (f: File) => /\.xlsx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** CSV or Excel bank export → column mapping (remembered in this browser) → preview → import; plus Firefly sync. */
export function CsvImport({ currency, accounts = [], onImported }: { currency: string; accounts?: Account[]; onImported: () => void }) {
  const t = useT();
  // The bank account the file comes from (statements are per account).
  const [account, setAccount] = useState("");
  const [text, setText] = useState("");
  // An Excel file replaces the pasted text until cleared.
  const [excel, setExcel] = useState<{ xlsx: string; name: string }>();
  const source: Source = excel ?? { text };
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [map, setMap] = useState<CsvMapping>({ date: 0, description: 1, amount: 2, dateFormat: "auto", decimal: ".", header: true });
  const [preview, setPreview] = useState<{ preview: ParsedTransaction[]; total: number; errors: string[] }>();
  const [msg, setMsg] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const { data: ff, mutate: refreshFf } = useSWR<{ configured: boolean; lastSync: string | null }>("/api/finance/firefly", fetcher);

  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setMsg(undefined);
    try {
      return await fn();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const analyse = (src: Source) =>
    run(async () => {
      const r = await sendJson<{ rows: string[][]; columns: number; guess: Partial<CsvMapping> }>("/api/finance/import", "POST", src);
      let saved: Partial<CsvMapping> = {};
      try {
        saved = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
      } catch {}
      // A remembered mapping wins when it fits this file's columns.
      const fits = Object.values(saved).every((v) => typeof v !== "number" || v < r.columns);
      const guess = Object.fromEntries(Object.entries(r.guess).filter(([, v]) => v !== undefined));
      setMap((m) => ({ ...m, ...guess, ...(fits ? saved : {}) }));
      setPreview(undefined);
      setStep({ kind: "map", rows: r.rows, columns: r.columns });
    });

  const doPreview = () => run(async () => setPreview(await sendJson("/api/finance/import", "POST", { ...source, mapping: map })));

  const doImport = () =>
    run(async () => {
      const r = await sendJson<{ added: number; skipped: number; errors: number }>("/api/finance/import", "POST", { ...source, mapping: map, commit: true, currency, account: account || null });
      try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(map));
      } catch {}
      setMsg({ text: [t.plural(r.added, "Imported {n} transaction", "Imported {n} transactions"), r.skipped ? t("{n} already there", { n: r.skipped }) : "", r.errors ? t("{n} unreadable lines skipped", { n: r.errors }) : ""].filter(Boolean).join(", ") + "." });
      setStep({ kind: "start" });
      setText("");
      setExcel(undefined);
      setPreview(undefined);
      onImported();
    });

  const sync = () =>
    run(async () => {
      const r = await sendJson<{ added: number; skipped: number }>("/api/finance/firefly", "POST");
      setMsg({ text: t("Firefly III: {added} new, {skipped} already imported.", { added: r.added, skipped: r.skipped }) });
      refreshFf();
      onImported();
    });

  const columnSelect = (key: keyof CsvMapping, label: string, optional = false) => {
    const cols = step.kind === "map" ? step.columns : 0;
    const header = step.kind === "map" && map.header ? step.rows[0] : undefined;
    return (
      <label className="flex flex-col gap-1 text-xs text-muted">
        {label}
        <select
          value={map[key] === undefined ? "" : String(map[key])}
          onChange={(e) => setMap({ ...map, [key]: e.target.value === "" ? undefined : Number(e.target.value) })}
          className={inputClass}
        >
          {optional && <option value="">—</option>}
          {Array.from({ length: cols }, (_, i) => (
            <option key={i} value={i}>
              {header?.[i] ? `${i + 1}: ${header[i]}` : t("Column {n}", { n: i + 1 })}
            </option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <section className="flex flex-col gap-4">
      {msg && (
        <p role="status" className={`rounded-xl px-3 py-2 text-sm ${msg.error ? "bg-[var(--err)]/15 text-[var(--err)]" : "glass"}`}>
          {msg.text}
        </p>
      )}

      {ff?.configured && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <div>
            <div className="font-medium">{t("Firefly III")}</div>
            <div className="text-xs text-muted">
              {t("Syncs daily. Last sync:")}{" "}{ff.lastSync ? new Date(ff.lastSync).toLocaleString(formatLocale()) : t("never")}
            </div>
          </div>
          <button onClick={sync} disabled={busy} className="flex items-center gap-1.5 rounded-full bg-chip px-4 py-2 text-sm hover:bg-hover disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> {t("Sync now")}
          </button>
        </div>
      )}

      <div className="glass flex flex-col gap-3 rounded-3xl p-4">
        <h2 className="font-semibold">{t("Import a bank export (CSV or Excel)")}</h2>
        {step.kind === "start" && (
          <>
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
              <Upload className="h-4 w-4" /> {t("Choose a CSV or .xlsx file")}
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (isExcel(f)) {
                    const x = { xlsx: await toBase64(f), name: f.name };
                    setExcel(x);
                    setText("");
                    return analyse(x);
                  }
                  const t = await f.text();
                  setExcel(undefined);
                  setText(t);
                  analyse({ text: t });
                }}
              />
            </label>
            <textarea
              aria-label={t("Or paste CSV")}
              placeholder={t("…or paste the CSV here")}
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={`${inputClass} h-auto py-2 font-mono text-xs`}
            />
            <button
              disabled={!text.trim() || busy}
              onClick={() => {
                setExcel(undefined);
                analyse({ text });
              }}
              className="w-fit rounded-full bg-chip px-4 py-2 text-sm hover:bg-hover disabled:opacity-50"
            >
              {t("Next: match columns")}
            </button>
          </>
        )}

        {step.kind === "map" && (
          <>
            {excel && <p className="text-xs text-muted">{excel.name}{t(": the first sheet with data. Dates and amounts are read as Excel stores them.")}</p>}
            <div className="overflow-x-auto rounded-xl bg-chip p-2">
              <table className="text-xs">
                <tbody>
                  {step.rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className={i === 0 && map.header ? "font-semibold" : "text-muted"}>
                      {r.map((c, j) => (
                        <td key={j} className="max-w-48 truncate px-2 py-0.5">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {columnSelect("date", t("Date"))}
              {columnSelect("description", t("Description"))}
              {columnSelect("amount", t("Amount (signed)"), true)}
              {columnSelect("category", t("Category"), true)}
              {columnSelect("debit", t("…or Debit column"), true)}
              {columnSelect("credit", t("…and Credit column"), true)}
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t("Date format")}
                <select value={map.dateFormat} onChange={(e) => setMap({ ...map, dateFormat: e.target.value as CsvMapping["dateFormat"] })} className={inputClass}>
                  <option value="auto">{t("Automatic")}</option>
                  <option value="YMD">2026-10-31</option>
                  <option value="DMY">31/10/2026</option>
                  <option value="MDY">10/31/2026</option>
                </select>
              </label>
              {!excel && (
                <label className="flex flex-col gap-1 text-xs text-muted">
                  {t("Decimal separator")}
                  <select value={map.decimal} onChange={(e) => setMap({ ...map, decimal: e.target.value as "." | "," })} className={inputClass}>
                    <option value=".">1,234.56</option>
                    <option value=",">1.234,56</option>
                  </select>
                </label>
              )}
            </div>
            {accounts.some((a) => !a.archived) && (
              <label className="flex max-w-xs flex-col gap-1 text-xs text-muted">
                {t("Import into account")}
                <select aria-label={t("Import into account")} value={account} onChange={(e) => setAccount(e.target.value)} className={inputClass}>
                  <option value="">{t("No account")}</option>
                  {accounts
                    .filter((a) => !a.archived)
                    .map((a) => (
                      <option key={a.id} value={a.name}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={map.header} onChange={(e) => setMap({ ...map, header: e.target.checked })} className="accent-[var(--accent)]" />
                {t("First row is a header")}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!map.invert} onChange={(e) => setMap({ ...map, invert: e.target.checked })} className="accent-[var(--accent)]" />
                {t("Spending is listed as positive")}
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={doPreview} disabled={busy} className="rounded-full bg-chip px-4 py-2 text-sm hover:bg-hover disabled:opacity-50">
                {t("Preview")}
              </button>
              <button onClick={() => setStep({ kind: "start" })} className="rounded-full px-4 py-2 text-sm text-muted hover:text-fg">
                {t("Back")}
              </button>
              {busy && <Loader2 className="h-5 w-5 animate-spin self-center text-muted" />}
            </div>

            {preview && (
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  {t("{n} transactions found", { n: preview.total })}{preview.errors.length ? `; ${t("{n} lines can't be read", { n: preview.errors.length })}` : ""}.
                </p>
                {preview.errors.slice(0, 5).map((e) => (
                  <p key={e} className="text-xs text-[var(--warn)]">
                    {e}
                  </p>
                ))}
                <table className="text-sm">
                  <tbody>
                    {preview.preview.map((t) => (
                      <tr key={t.externalId} className="border-t border-line/50">
                        <td className="py-1 pr-3 text-muted tabular-nums">{t.date}</td>
                        <td className="max-w-80 truncate py-1 pr-3">{t.description}</td>
                        <td className="py-1 pr-3 text-xs text-muted">{t.category}</td>
                        <td className={`py-1 text-right tabular-nums ${t.amountCents > 0 ? "text-[var(--ok)]" : ""}`}>{money(t.amountCents, currency, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  onClick={doImport}
                  disabled={busy || !preview.total}
                  className="w-fit rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
                >
                  {t("Import")}{" "}{preview.total} {t("transactions")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
