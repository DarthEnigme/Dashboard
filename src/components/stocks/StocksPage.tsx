"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { motion } from "framer-motion";
import { GitCompareArrows, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import type { Portfolio, StocksData, Transaction } from "@/lib/stocks/types";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { AppHeader } from "../AppHeader";
import { IconButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";
import { stockHref } from "./format";
import { PortfolioTab } from "./PortfolioTab";
import { SymbolSearch } from "./SymbolSearch";
import { AlertsTab } from "./AlertsTab";
import { DividendsTab } from "./DividendsTab";
import type { Tab } from "./tabIds";
import { ImportTab } from "./ImportTab";
import { PortfolioDialog } from "./PortfolioDialog";
import { TransactionsTab } from "./TransactionsTab";
import { WatchTab } from "./WatchTab";
import { TransactionDialog } from "./TransactionDialog";

/** The page's sections: the first three show recorded trades (and an invitation to record one when there are none). */
const TABS: { id: Tab; label: string }[] = [
  { id: "portfolio", label: msg("Portfolio") },
  { id: "transactions", label: msg("Transactions") },
  { id: "dividends", label: msg("Dividends") },
  { id: "watchlist", label: msg("Watched") },
  { id: "alerts", label: msg("Alerts") },
  { id: "import", label: msg("Import & brokers") },
];

const PORTFOLIO_KEY = "page.stocks.portfolio";
const BENCHMARK_KEY = "page.stocks.benchmark";
const stored = (key: string) => {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};
const store = (key: string, value: string | undefined) => {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private windows: the choice just isn't kept
  }
};

/**
 * Stocks: what you hold and how it is doing, your trades, your dividends, symbols you watch, alerts,
 * imports and brokers. `add` opens a new transaction for that symbol; `tab` opens a section
 * (`alert`: the alerts, with a new one for that symbol).
 */
export function StocksPage({ add, tab: firstTab, alert }: { add?: string; tab?: Tab; alert?: string }) {
  const t = useT();
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<number>();
  const [benchmark, setBenchmark] = useState<string>();
  const [tab, setTab] = useState<Tab>(alert ? "alerts" : (firstTab ?? "portfolio"));
  const [editing, setEditing] = useState<Transaction | { portfolio_id: number; symbol?: string }>();
  const [managing, setManaging] = useState<Portfolio | "new">();
  const query = new URLSearchParams({ ...(portfolio ? { portfolio: String(portfolio) } : {}), ...(benchmark ? { benchmark } : {}) });
  const { data, mutate, error, isLoading } = useSWR<StocksData>(`/api/stocks?${query}`, fetcher, { keepPreviousData: true });

  // Back on the portfolio and benchmark of last time.
  useEffect(() => {
    setPortfolio(Number(stored(PORTFOLIO_KEY)) || undefined);
    setBenchmark(stored(BENCHMARK_KEY));
  }, []);

  // Arriving from a stock's page to record a trade in it.
  const firstPortfolio = data?.portfolios[0]?.id;
  useEffect(() => {
    if (add && firstPortfolio) setEditing((e) => e ?? { portfolio_id: firstPortfolio, symbol: add });
  }, [add, firstPortfolio]);

  const showPortfolio = (id: number | undefined) => {
    setPortfolio(id);
    store(PORTFOLIO_KEY, id === undefined ? undefined : String(id));
  };
  const showBenchmark = (symbol: string) => {
    setBenchmark(symbol);
    store(BENCHMARK_KEY, symbol);
  };
  const shown = data?.portfolios.find((p) => p.id === data.portfolio);
  const closeEditing = () => {
    setEditing(undefined);
    if (add) router.replace("/stocks");
  };

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <AppHeader title={t("Stocks")} subtitle={t("Your portfolio, your dividends, and a closer look at any company. Prices from Yahoo Finance, a little delayed.")}>
        <Link href="/stocks/compare" className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm text-muted hover:bg-hover hover:text-fg">
          <GitCompareArrows className="h-4 w-4" /> {t("Compare")}
        </Link>
        {data && (
          <button type="button" onClick={() => setEditing({ portfolio_id: shown?.id ?? data.portfolios[0].id })} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
            <Plus className="h-4 w-4" /> {t("New transaction")}
          </button>
        )}
      </AppHeader>

      {error && (
        <p role="alert" className="rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">
          {(error as Error).message}
        </p>
      )}
      {data && data.errors.length > 0 && (
        <p role="status" className="rounded-xl bg-[var(--warn)]/15 px-3 py-2 text-sm text-[var(--warn)]">
          {t("Yahoo Finance didn't answer for: {list}. Those are valued at the last price you paid.", { list: data.errors.join("; ") })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {data && (
          <>
            <select value={data.portfolio ?? ""} onChange={(e) => showPortfolio(Number(e.target.value) || undefined)} aria-label={t("Portfolio")} className={`${inputBase} w-48 font-medium`}>
              {data.portfolios.length > 1 && <option value="">{t("All portfolios")}</option>}
              {data.portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {(shown ?? (data.portfolios.length === 1 ? data.portfolios[0] : undefined)) && (
              <IconButton label="Edit portfolio" onClick={() => setManaging(shown ?? data.portfolios[0])}>
                <Pencil className="h-4 w-4" />
              </IconButton>
            )}
            <IconButton label="New portfolio" onClick={() => setManaging("new")}>
              <Plus className="h-4 w-4" />
            </IconButton>
          </>
        )}
        <div className="ml-auto w-full max-w-sm">
          <SymbolSearch placeholder={t("Look up a company, fund or index")} onPick={(hit) => router.push(stockHref(hit.symbol))} />
        </div>
      </div>

      <nav className="glass flex w-fit flex-wrap gap-1 rounded-full p-1 text-sm" role="tablist" aria-label={t("Stocks sections")}>
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={`relative rounded-full px-4 py-1.5 ${tab === x.id ? "text-white" : "text-muted hover:text-fg"}`}>
            {tab === x.id && <motion.span layoutId="stocks-tab" className="tab-pill absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
            <span className="relative">{t(x.label)}</span>
          </button>
        ))}
      </nav>

      {tab === "watchlist" ? (
        <WatchTab />
      ) : !data ? (
        <p className="text-muted">{isLoading ? t("Loading…") : ""}</p>
      ) : (
        <Section
          tab={tab}
          data={data}
          alert={alert}
          onBenchmark={showBenchmark}
          onOpen={setEditing}
          onFirst={() => setEditing({ portfolio_id: shown?.id ?? data.portfolios[0].id })}
          onChanged={() => void mutate()}
        />
      )}

      {editing && data && <TransactionDialog transaction={editing} portfolios={data.portfolios} onSaved={() => void mutate()} onClose={closeEditing} />}
      {managing && data && (
        <PortfolioDialog
          portfolio={managing === "new" ? undefined : managing}
          canDelete={data.portfolios.length > 1}
          onSaved={(list, removed) => {
            // A new portfolio is the one to look at; a deleted one can't be.
            if (managing === "new") showPortfolio(list[list.length - 1].id);
            else if (removed) showPortfolio(undefined);
            void mutate();
          }}
          onClose={() => setManaging(undefined)}
        />
      )}
    </main>
  );
}

interface SectionProps {
  tab: Exclude<Tab, "watchlist">;
  data: StocksData;
  alert?: string;
  onBenchmark: (symbol: string) => void;
  onOpen: (t: Transaction) => void;
  onFirst: () => void;
  onChanged: () => void;
}

/** The sections about recorded trades, which invite a first one when there are none. */
const NEEDS_TRADES = new Set<Tab>(["portfolio", "transactions", "dividends"]);

/** One section of the page, from its data. */
function Section({ tab, data, alert, onBenchmark, onOpen, onFirst, onChanged }: SectionProps) {
  const t = useT();
  if (NEEDS_TRADES.has(tab) && !data.transactions.length)
    return (
      <div className="glass flex flex-col items-center gap-3 rounded-3xl p-10 text-center">
        <p className="text-muted">{t("Record what you bought to see your portfolio: its value, its gains and its dividends follow from there.")}</p>
        <button type="button" onClick={onFirst} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("Add your first transaction")}
        </button>
      </div>
    );
  const sections: Record<SectionProps["tab"], () => React.ReactNode> = {
    portfolio: () => <PortfolioTab data={data} onBenchmark={onBenchmark} />,
    transactions: () => <TransactionsTab data={data} onOpen={onOpen} />,
    dividends: () => <DividendsTab data={data} />,
    alerts: () => <AlertsTab portfolios={data.portfolios} preset={alert} />,
    import: () => <ImportTab portfolios={data.portfolios} portfolio={data.portfolio} onImported={onChanged} />,
  };
  return sections[tab]();
}
