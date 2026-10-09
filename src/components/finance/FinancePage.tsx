"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, Coins, Landmark, PiggyBank } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { Summary } from "@/lib/finance/aggregate";
import { money, periodLabel } from "@/lib/finance/format";
import { FinanceCharts } from "../charts/FinanceCharts";
import { Sankey } from "../charts/Sankey";
import { Budgets } from "./Budgets";
import { Accounts, ACCOUNTS_KEY } from "./Accounts";
import type { AccountWithBalance } from "@/lib/finance/accounts";
import { FlowExport } from "./FlowExport";
import { QuickAdd } from "./QuickAdd";
import { TransactionList } from "./TransactionList";
import { CategoryManager } from "./CategoryManager";
import { CsvImport } from "./CsvImport";
import { Plan } from "./Plan";
import { GOALS_KEY, SaveDialog, Savings } from "./Savings";
import type { Goal } from "@/lib/finance/goals";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";

const VIEWS = ["overview", "flow", "transactions", "accounts", "plan", "savings", "categories", "import"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = {
  overview: msg("Overview"),
  flow: msg("Flow"),
  transactions: msg("Transactions"),
  accounts: msg("Accounts"),
  plan: msg("Plan"),
  savings: msg("Savings"),
  categories: msg("Categories"),
  import: msg("Import"),
};

const shift = (period: string, n: number) => {
  if (period.length === 4) return String(Number(period) + n);
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/** Offered in the currency picker besides the ones transactions use (all have ECB rates). */
const COMMON = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY", "SEK", "NOK", "DKK", "PLN", "CZK"];
const CURRENCY_KEY = "page.finance.currency";

type SummaryResponse = Summary & { currencies: string[]; ratesDate: string | null };

export function FinancePage({ currency: defaultCurrency }: { currency: string }) {
  const t = useT();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<View>("overview");
  // Display currency: per browser, defaults to the finance currency setting.
  const [currency, setCurrency] = useState(defaultCurrency);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CURRENCY_KEY);
      if (saved && /^[A-Z]{3}$/.test(saved)) setCurrency(saved);
    } catch {}
  }, []);
  const pickCurrency = (c: string) => {
    setCurrency(c);
    try {
      if (c === defaultCurrency) localStorage.removeItem(CURRENCY_KEY);
      else localStorage.setItem(CURRENCY_KEY, c);
    } catch {}
  };
  const { mutate } = useSWRConfig();
  // One account, or all of them (undefined); "" = transactions without an account.
  const [account, setAccount] = useState<string>();
  const { data: accounts } = useSWR<AccountWithBalance[]>(ACCOUNTS_KEY, fetcher);
  const accountQuery = account === undefined ? "" : `&account=${encodeURIComponent(account)}`;
  const { data: summary } = useSWR<SummaryResponse>(`/api/finance/summary?period=${period}&currency=${currency}${accountQuery}`, fetcher, { keepPreviousData: true });
  const currencies = [...new Set([currency, defaultCurrency, ...(summary?.currencies ?? []), ...COMMON])];
  const { data: goals, mutate: setGoals } = useSWR<Goal[]>(GOALS_KEY, fetcher);
  const [saving, setSaving] = useState(false);
  const flowChart = useRef<HTMLDivElement>(null);

  /** After any change: refresh every finance query (summary, lists, categories). */
  const refresh = () => mutate((key) => typeof key === "string" && key.startsWith("/api/finance/"));

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {t("Dashboard")}
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("Finance")}</h1>
          <p className="text-muted">
            {t("Spending and income, in")}{" "}{currency}.
            {summary && summary.converted > 0 && summary.ratesDate && <> {t("Other currencies converted at ECB rates of")}{" "}{summary.ratesDate}.</>}
          </p>
          {summary && summary.skipped > 0 && (
            <p className="text-sm text-[var(--warn)]">
              {summary.skipped} {summary.skipped === 1 ? "transaction is" : "transactions are"} {t("in a currency with no exchange rate and left out of the totals.")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => (goals?.length ? setSaving(true) : setView("savings"))}
            className="glass glass-interactive flex h-9 items-center gap-1.5 rounded-full px-3 text-sm"
            title={goals?.length ? t("Put money aside for a savings goal") : t("Create a savings goal")}
          >
            <PiggyBank className="h-4 w-4" /> {t("Savings")}
          </button>
          {!!accounts?.length && (
            <label className="glass flex h-9 items-center gap-1.5 rounded-full pr-1 pl-3 text-sm" title={t("Only this account's transactions")}>
              <Landmark className="h-4 w-4 text-muted" />
              <select
                aria-label={t("Account")}
                value={account ?? "*"}
                onChange={(e) => setAccount(e.target.value === "*" ? undefined : e.target.value)}
                className="h-full max-w-40 cursor-pointer rounded-full bg-transparent pr-2 outline-none"
              >
                <option value="*">{t("All accounts")}</option>
                {accounts
                  .filter((a) => !a.archived || a.name === account)
                  .map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                <option value="">{t("No account")}</option>
              </select>
            </label>
          )}
          <label className="glass flex h-9 items-center gap-1.5 rounded-full pr-1 pl-3 text-sm" title={t("Show amounts in this currency")}>
            <Coins className="h-4 w-4 text-muted" />
            <select
              aria-label={t("Currency")}
              value={currency}
              onChange={(e) => pickCurrency(e.target.value)}
              className="h-full cursor-pointer rounded-full bg-transparent pr-2 outline-none"
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {c === defaultCurrency ? ` ${t("(default)")}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="glass flex items-center rounded-full p-1">
            <button aria-label={t("Previous period")} onClick={() => setPeriod((p) => shift(p, -1))} className="rounded-full p-1.5 text-muted hover:bg-hover hover:text-fg">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-32 px-2 text-center text-sm font-medium">{periodLabel(period)}</span>
            <button aria-label={t("Next period")} onClick={() => setPeriod((p) => shift(p, 1))} className="rounded-full p-1.5 text-muted hover:bg-hover hover:text-fg">
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
                  {k === "year" ? t("Year") : t("Month")}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <QuickAdd currency={currency} accounts={accounts} account={account} onAdded={refresh} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t("Spent")} value={summary ? money(summary.expense, summary.currency) : "–"} />
        <Stat label={t("Income")} value={summary ? money(summary.income, summary.currency) : "–"} />
        <Stat
          label={t("Net")}
          value={summary ? money(summary.net, summary.currency, true) : "–"}
          tone={summary && summary.net < 0 ? "bad" : "good"}
          note={summary ? t.plural(summary.count, "{n} transaction", "{n} transactions") : undefined}
        />
      </div>

      <nav className="glass flex w-fit flex-wrap gap-1 rounded-full p-1 text-sm" role="tablist" aria-label={t("Finance sections")}>
        {VIEWS.map((v) => (
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
            <span className="relative">{t(VIEW_LABELS[v])}</span>
          </button>
        ))}
      </nav>

      {view === "overview" && summary && (
        <>
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <section className="glass rounded-3xl p-5" aria-labelledby="flow-title">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 id="flow-title" className="text-sm font-semibold">
                  {t("Money flow")}
                </h2>
                <FlowExport chart={flowChart} flow={summary.flow} currency={summary.currency} period={period} />
              </div>
              <div ref={flowChart}>
                <Sankey flow={summary.flow} currency={summary.currency} height={220} />
              </div>
            </section>
            <section className="glass rounded-3xl p-5" aria-labelledby="budgets-title">
              <h2 id="budgets-title" className="mb-3 text-sm font-semibold">
                {t("Budgets")}
              </h2>
              <Budgets budgets={summary.budgets} currency={summary.currency} yearly={period.length === 4} />
            </section>
          </div>
          <section className="glass rounded-3xl p-5">
            <FinanceCharts
              size="detail"
              charts={{ currency: summary.currency, donut: summary.categories, bars: summary.months, balance: summary.balance }}
            />
          </section>
        </>
      )}
      {view === "flow" && summary && (
        <section className="glass rounded-3xl p-5" aria-labelledby="flow-full-title">
          <div className="mb-1 flex items-start justify-between gap-2">
            <h2 id="flow-full-title" className="text-sm font-semibold">
              {t("Where the money came from and where it went ·")} {periodLabel(period)}
            </h2>
            <FlowExport chart={flowChart} flow={summary.flow} currency={summary.currency} period={period} />
          </div>
          <p className="mb-4 text-xs text-muted">{t("Income by category on the left, spending on the right. Hover a band for its share.")}</p>
          <div ref={flowChart}>
            <Sankey flow={summary.flow} currency={summary.currency} height={420} />
          </div>
        </section>
      )}
      {view === "transactions" && <TransactionList period={period} currency={currency} account={account} accounts={accounts} onChanged={refresh} />}
      {view === "accounts" && <Accounts currency={defaultCurrency} selected={account} onSelect={setAccount} onChanged={refresh} />}
      {view === "plan" && <Plan currency={currency} onChanged={refresh} />}
      {view === "savings" && <Savings currency={defaultCurrency} />}
      {view === "categories" && <CategoryManager onChanged={refresh} currency={defaultCurrency} />}
      {view === "import" && <CsvImport currency={currency} accounts={accounts} onImported={refresh} />}
      {saving && goals && <SaveDialog goals={goals} onClose={() => setSaving(false)} onDone={(list) => setGoals(list, { revalidate: false })} />}
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
