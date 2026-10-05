"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, RefreshCw, Upload } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { CsvMapping, ParsedTransaction } from "@/lib/finance/csv";
import { money } from "@/lib/finance/format";
import { inputClass } from "../edit/FieldInput";

type Step = { kind: "start" } | { kind: "map"; rows: string[][]; columns: number };

const PRESETS_KEY = "page:csv-mapping";

/** CSV bank export → column mapping (remembered in this browser) → preview → import; plus Firefly sync. */
export function CsvImport({ currency, onImported }: { currency: string; onImported: () => void }) {
  const [text, setText] = useState("");
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

  const analyse = (csv: string) =>
    run(async () => {
      const r = await sendJson<{ rows: string[][]; columns: number; guess: Partial<CsvMapping> }>("/api/finance/import", "POST", { text: csv });
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

  const doPreview = () => run(async () => setPreview(await sendJson("/api/finance/import", "POST", { text, mapping: map })));

  const doImport = () =>
    run(async () => {
      const r = await sendJson<{ added: number; skipped: number; errors: number }>("/api/finance/import", "POST", { text, mapping: map, commit: true });
      try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(map));
      } catch {}
      setMsg({ text: `Imported ${r.added} transactions${r.skipped ? `, ${r.skipped} already there` : ""}${r.errors ? `, ${r.errors} unreadable lines skipped` : ""}.` });
      setStep({ kind: "start" });
      setText("");
      setPreview(undefined);
      onImported();
    });

  const sync = () =>
    run(async () => {
      const r = await sendJson<{ added: number; skipped: number }>("/api/finance/firefly", "POST");
      setMsg({ text: `Firefly III: ${r.added} new, ${r.skipped} already imported.` });
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
              {header?.[i] ? `${i + 1}: ${header[i]}` : `Column ${i + 1}`}
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
            <div className="font-medium">Firefly III</div>
            <div className="text-xs text-muted">
              Syncs daily. Last sync: {ff.lastSync ? new Date(ff.lastSync).toLocaleString() : "never"}
            </div>
          </div>
          <button onClick={sync} disabled={busy} className="flex items-center gap-1.5 rounded-full bg-chip px-4 py-2 text-sm hover:bg-hover disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Sync now
          </button>
        </div>
      )}

      <div className="glass flex flex-col gap-3 rounded-3xl p-4">
        <h2 className="font-semibold">Import a bank export (CSV)</h2>
        {step.kind === "start" && (
          <>
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
              <Upload className="h-4 w-4" /> Choose a CSV file
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const t = await f.text();
                  setText(t);
                  analyse(t);
                }}
              />
            </label>
            <textarea
              aria-label="Or paste CSV"
              placeholder="…or paste the CSV here"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={`${inputClass} h-auto py-2 font-mono text-xs`}
            />
            <button
              disabled={!text.trim() || busy}
              onClick={() => analyse(text)}
              className="w-fit rounded-full bg-chip px-4 py-2 text-sm hover:bg-hover disabled:opacity-50"
            >
              Next: match columns
            </button>
          </>
        )}

        {step.kind === "map" && (
          <>
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
              {columnSelect("date", "Date")}
              {columnSelect("description", "Description")}
              {columnSelect("amount", "Amount (signed)", true)}
              {columnSelect("category", "Category", true)}
              {columnSelect("debit", "…or Debit column", true)}
              {columnSelect("credit", "…and Credit column", true)}
              <label className="flex flex-col gap-1 text-xs text-muted">
                Date format
                <select value={map.dateFormat} onChange={(e) => setMap({ ...map, dateFormat: e.target.value as CsvMapping["dateFormat"] })} className={inputClass}>
                  <option value="auto">Automatic</option>
                  <option value="YMD">2026-10-31</option>
                  <option value="DMY">31/10/2026</option>
                  <option value="MDY">10/31/2026</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Decimal separator
                <select value={map.decimal} onChange={(e) => setMap({ ...map, decimal: e.target.value as "." | "," })} className={inputClass}>
                  <option value=".">1,234.56</option>
                  <option value=",">1.234,56</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={map.header} onChange={(e) => setMap({ ...map, header: e.target.checked })} className="accent-[var(--accent)]" />
                First row is a header
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!map.invert} onChange={(e) => setMap({ ...map, invert: e.target.checked })} className="accent-[var(--accent)]" />
                Spending is listed as positive
              </label>
            </div>
            <div className="flex gap-2">
              <button onClick={doPreview} disabled={busy} className="rounded-full bg-chip px-4 py-2 text-sm hover:bg-hover disabled:opacity-50">
                Preview
              </button>
              <button onClick={() => setStep({ kind: "start" })} className="rounded-full px-4 py-2 text-sm text-muted hover:text-fg">
                Back
              </button>
              {busy && <Loader2 className="h-5 w-5 animate-spin self-center text-muted" />}
            </div>

            {preview && (
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  {preview.total} transactions found{preview.errors.length ? `; ${preview.errors.length} lines can't be read` : ""}.
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
                  Import {preview.total} transactions
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
