"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { Summary } from "@/lib/finance/aggregate";
import { money } from "@/lib/finance/format";
import { FinanceCharts } from "../charts/FinanceCharts";
import { Sankey } from "../charts/Sankey";
import { Budgets } from "./Budgets";
import { QuickAdd } from "./QuickAdd";
import { TransactionList } from "./TransactionList";
import { CategoryManager } from "./CategoryManager";
import { CsvImport } from "./CsvImport";

type View = "overview" | "flow" | "transactions" | "categories" | "import";

const shift = (period: string, n: number) => {
  if (period.length === 4) return String(Number(period) + n);
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

export function FinancePage({ currency }: { currency: string }) {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<View>("overview");
  const { mutate } = useSWRConfig();
  const { data: summary } = useSWR<Summary>(`/api/finance/summary?period=${period}`, fetcher, { keepPreviousData: true });

  /** After any change: refresh every finance query (summary, lists, categories). */
  const refresh = () => mutate((key) => typeof key === "string" && key.startsWith("/api/finance/"));

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finance</h1>
          <p className="text-muted">Spending and income, in {currency}.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="glass flex items-center rounded-full p-1">
            <button aria-label="Previous period" onClick={() => setPeriod((p) => shift(p, -1))} className="rounded-full p-1.5 text-muted hover:bg-hover hover:text-fg">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-32 px-2 text-center text-sm font-medium">{summary?.period.label ?? period}</span>
            <button aria-label="Next period" onClick={() => setPeriod((p) => shift(p, 1))} className="rounded-full p-1.5 text-muted hover:bg-hover hover:text-fg">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="glass flex rounded-full p-1 text-sm">
            {(["month", "year"] as const).map((k) => {
              const active = k === "year" ? period.length === 4 : period.length === 7;
              return (
                <button
                  key={k}
                  onClick={() => setPeriod((p) => (k === "year" ? p.slice(0, 4) : p.length === 4 ? `${p}-${new Date().toISOString().slice(5, 7)}` : p))}
                  className={`rounded-full px-3 py-1 capitalize ${active ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
                >
                  {k}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <QuickAdd currency={currency} onAdded={refresh} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Spent" value={summary ? money(summary.expense, currency) : "–"} />
        <Stat label="Income" value={summary ? money(summary.income, currency) : "–"} />
        <Stat
          label="Net"
          value={summary ? money(summary.net, currency, true) : "–"}
          tone={summary && summary.net < 0 ? "bad" : "good"}
          note={summary ? `${summary.count} transactions` : undefined}
        />
      </div>

      <nav className="glass flex w-fit flex-wrap gap-1 rounded-full p-1 text-sm" role="tablist" aria-label="Finance sections">
        {(["overview", "flow", "transactions", "categories", "import"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`relative rounded-full px-4 py-1.5 capitalize ${view === v ? "text-white" : "text-muted hover:text-fg"}`}
          >
            {view === v && (
              <motion.span
                layoutId="finance-tab"
                className="tab-pill absolute inset-0 rounded-full bg-accent"
                transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              />
            )}
            <span className="relative">{v}</span>
          </button>
        ))}
      </nav>

      {view === "overview" && summary && (
        <>
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <section className="glass rounded-3xl p-5" aria-labelledby="flow-title">
              <h2 id="flow-title" className="mb-2 text-sm font-semibold">
                Money flow
              </h2>
              <Sankey flow={summary.flow} currency={currency} height={220} />
            </section>
            <section className="glass rounded-3xl p-5" aria-labelledby="budgets-title">
              <h2 id="budgets-title" className="mb-3 text-sm font-semibold">
                Budgets
              </h2>
              <Budgets budgets={summary.budgets} currency={currency} yearly={period.length === 4} />
            </section>
          </div>
          <section className="glass rounded-3xl p-5">
            <FinanceCharts
              size="detail"
              charts={{ currency, donut: summary.categories, bars: summary.months, balance: summary.balance }}
            />
          </section>
        </>
      )}
      {view === "flow" && summary && (
        <section className="glass rounded-3xl p-5" aria-labelledby="flow-full-title">
          <h2 id="flow-full-title" className="mb-1 text-sm font-semibold">
            Where the money came from and where it went · {summary.period.label}
          </h2>
          <p className="mb-4 text-xs text-muted">Income by category on the left, spending on the right. Hover a band for its share.</p>
          <Sankey flow={summary.flow} currency={currency} height={420} />
        </section>
      )}
      {view === "transactions" && <TransactionList period={period} currency={currency} onChanged={refresh} />}
      {view === "categories" && <CategoryManager onChanged={refresh} currency={currency} />}
      {view === "import" && <CsvImport currency={currency} onImported={refresh} />}
    </main>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "bad" }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-semibold ${tone === "bad" ? "text-[var(--err)]" : ""}`}>{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  );
}
