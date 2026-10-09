"use client";

import { useEffect } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, Printer } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { Summary } from "@/lib/finance/aggregate";
import { categoryColor, money, periodLabel } from "@/lib/finance/format";
import { Sankey } from "../charts/Sankey";
import { Budgets } from "./Budgets";
import { formatLocale } from "@/i18n/format";
import { useT } from "@/i18n/client";

/**
 * A month or year on one page: totals, the money flow, budgets and where the money went. Printing
 * (or "Save as PDF") uses light colours whatever the theme; with ?print=1 the print dialog opens
 * once the chart is drawn.
 */
export function FinanceReport({ title, period, currency, autoPrint }: { title: string; period: string; currency: string; autoPrint: boolean }) {
  const t = useT();
  const { data: s, error } = useSWR<Summary>(`/api/finance/summary?period=${period}&currency=${currency}`, fetcher);

  useEffect(() => {
    if (!s || !autoPrint) return;
    // Give the Sankey a frame to measure its width and draw.
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [s, autoPrint]);

  const spent = s?.categories.reduce((a, c) => a + c.cents, 0) ?? 0;

  return (
    <main className="report mx-auto flex max-w-4xl flex-col gap-5 px-4 py-8 sm:px-6">
      <div className="no-print flex items-center justify-between gap-3">
        <Link href="/finance" className="flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> {t("Finance")}
        </Link>
        <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Printer className="h-4 w-4" /> {t("Download PDF")}
        </button>
      </div>

      <header>
        <p className="text-sm text-muted">{title} {t("· Finance report")}</p>
        <h1 className="text-3xl font-bold tracking-tight">{periodLabel(period)}</h1>
        {s && (
          <p className="text-xs text-muted">
            {s.period.from} {t("to")}{" "}{s.period.to} · {s.count} {t("transactions · amounts in")}{" "}{s.currency}
            {s.skipped > 0 && ` · ${t("{n} left out (no exchange rate)", { n: s.skipped })}`}
          </p>
        )}
      </header>

      {error && <p className="text-[var(--err)]">{(error as Error).message}</p>}
      {!s && !error && <p className="text-muted">{t("Loading…")}</p>}

      {s && (
        <>
          <section className="report-card grid grid-cols-3 gap-3" aria-label={t("Totals")}>
            {[
              { label: t("Income"), value: money(s.income, s.currency) },
              { label: t("Spent"), value: money(s.expense, s.currency) },
              { label: t("Net"), value: money(s.net, s.currency, true), bad: s.net < 0 },
            ].map((t) => (
              <div key={t.label} className="glass rounded-2xl p-4">
                <div className="text-xs text-muted">{t.label}</div>
                <div className={`text-2xl font-semibold tabular-nums ${t.bad ? "text-[var(--err)]" : ""}`}>{t.value}</div>
              </div>
            ))}
          </section>

          <section className="glass report-card rounded-3xl p-5" aria-labelledby="r-flow">
            <h2 id="r-flow" className="mb-3 text-sm font-semibold">
              {t("Money flow")}
            </h2>
            <Sankey flow={s.flow} currency={s.currency} height={300} />
          </section>

          <div className="grid gap-5 sm:grid-cols-2">
            <section className="glass report-card rounded-3xl p-5" aria-labelledby="r-cats">
              <h2 id="r-cats" className="mb-3 text-sm font-semibold">
                {t("Spending by category")}
              </h2>
              {s.categories.length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {s.categories.map((c) => (
                      <tr key={c.name} className="border-t border-line/60 first:border-0">
                        <td className="py-1.5">
                          <span className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px] align-middle" style={{ background: categoryColor(c.slot, c.color) }} aria-hidden />
                          {c.name}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{money(c.cents, s.currency)}</td>
                        <td className="w-14 py-1.5 text-right text-muted tabular-nums">{spent ? Math.round((c.cents / spent) * 100) : 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted">{t("No spending in this period.")}</p>
              )}
            </section>
            <section className="glass report-card rounded-3xl p-5" aria-labelledby="r-budgets">
              <h2 id="r-budgets" className="mb-3 text-sm font-semibold">
                {t("Budgets")}
              </h2>
              <Budgets budgets={s.budgets} currency={s.currency} yearly={period.length === 4} />
            </section>
          </div>
          <p className="text-xs text-muted">{t("Generated")}{" "}{new Date().toLocaleString(formatLocale())}.</p>
        </>
      )}
    </main>
  );
}
