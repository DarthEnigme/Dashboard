"use client";

import { useState } from "react";
import useSWR from "swr";
import { Search } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { inputBase } from "./FieldInput";
import { useT } from "@/i18n/client";

type Entry = { ts: number; user: string | null; action: string; detail: string | null };

/** Sign-ins, account changes, config saves, actions: who did what, newest first. */
export function AuditPanel() {
  const t = useT();
  const [q, setQ] = useState("");
  const [pages, setPages] = useState<Entry[][]>([]);
  const { data, error } = useSWR<Entry[]>(`/api/audit?q=${encodeURIComponent(q)}`, fetcher, { keepPreviousData: true });
  const rows = [...(data ?? []), ...pages.flat()];
  const more = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    const next = await fetcher<Entry[]>(`/api/audit?q=${encodeURIComponent(q)}&before=${last.ts}`);
    setPages((p) => [...p, next]);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{t("Audit log")}</h2>
        <label className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPages([]);
            }}
            placeholder={t("user, action…")}
            aria-label={t("Filter the audit log")}
            className={`${inputBase} w-48`}
          />
        </label>
      </div>
      {error && <p className="text-sm text-[var(--err)]">{error.message}</p>}
      <div className="max-h-96 overflow-auto rounded-2xl border border-line">
        <table className="w-full text-xs">
          <thead className="sticky top-0" style={{ background: "var(--dialog)" }}>
            <tr className="text-left text-muted">
              <th className="px-3 py-2 font-medium">{t("When")}</th>
              <th className="px-3 py-2 font-medium">{t("Who")}</th>
              <th className="px-3 py-2 font-medium">{t("What")}</th>
              <th className="px-3 py-2 font-medium">{t("Details")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.ts}-${i}`} className="border-t border-line/50 align-top">
                <td className="px-3 py-1.5 whitespace-nowrap text-muted tabular-nums">{new Date(r.ts).toLocaleString()}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{r.user ?? "–"}</td>
                <td className={`px-3 py-1.5 whitespace-nowrap ${/failed|refused/.test(r.action) ? "text-[var(--err)]" : ""}`}>{r.action}</td>
                <td className="max-w-md truncate px-3 py-1.5 font-mono text-muted" title={r.detail ?? ""}>
                  {r.detail ?? ""}
                </td>
              </tr>
            ))}
            {data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted">
                  {t("Nothing found.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length >= 100 && (pages.length === 0 || pages[pages.length - 1].length === 100) && (
        <button onClick={() => void more()} className="w-fit rounded-full bg-chip px-3 py-1.5 text-sm hover:bg-hover">
          {t("Older entries")}
        </button>
      )}
    </section>
  );
}
