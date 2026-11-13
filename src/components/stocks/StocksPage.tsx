"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { motion } from "framer-motion";
import { GitCompareArrows, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import type { Portfolio, PortfolioList, StocksData, Transaction } from "@/lib/stocks/types";
import { useRemembered } from "@/lib/useRemembered";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { AppHeader } from "../AppHeader";
import { IconButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";
import { stockHref } from "./format";
import { PortfolioSelect } from "./parts";
import { PortfolioTab } from "./PortfolioTab";
import { SymbolSearch } from "./SymbolSearch";
import { AlertsTab } from "./AlertsTab";
import { DividendsTab } from "./DividendsTab";
import type { Tab } from "./tabIds";
import { ImportTab } from "./ImportTab";
import { InvestorsTab } from "./InvestorsTab";
import { RebalanceTab } from "./RebalanceTab";
import { PortfolioDialog } from "./PortfolioDialog";
import { TransactionsTab } from "./TransactionsTab";
import { WatchTab } from "./WatchTab";
import { TransactionDialog } from "./TransactionDialog";

type TradesTab = "portfolio" | "transactions" | "dividends";

/** What a section that doesn't show recorded trades is drawn with. */
interface SectionContext {
  portfolios: Portfolio[];
  shown: Portfolio | undefined;
  /** A symbol to start a new alert for. */
  alert?: string;
  changed: () => void;
}

/**
 * The page's sections. Those about recorded trades need the portfolio worked out with prices (and
 * invite a first trade when there are none); the others draw themselves from the portfolio list.
 */
const TABS: ({ id: TradesTab; label: string } | { id: Exclude<Tab, TradesTab>; label: string; render: (c: SectionContext) => ReactNode })[] = [
  { id: "portfolio", label: msg("Portfolio") },
  { id: "transactions", label: msg("Transactions") },
  { id: "dividends", label: msg("Dividends") },
  { id: "rebalance", label: msg("Rebalance"), render: (c) => <RebalanceTab key={c.shown?.id ?? 0} portfolio={c.shown?.id ?? null} /> },
  { id: "investors", label: msg("Investors"), render: () => <InvestorsTab /> },
  { id: "watchlist", label: msg("Watched"), render: () => <WatchTab /> },
  { id: "alerts", label: msg("Alerts"), render: (c) => <AlertsTab portfolios={c.portfolios} preset={c.alert} /> },
  { id: "import", label: msg("Import & brokers"), render: (c) => <ImportTab portfolios={c.portfolios} portfolio={c.shown?.id ?? null} onImported={c.changed} /> },
];

const PORTFOLIO_KEY = "page.stocks.portfolio";
const BENCHMARK_KEY = "page.stocks.benchmark";

/**
 * Stocks: what you hold and how it is doing, your trades, your dividends, symbols you watch, alerts,
 * imports and brokers. `add` opens a new transaction for that symbol; `tab` opens a section
 * (`alert`: the alerts, with a new one for that symbol).
 */
export function StocksPage({ add, tab: firstTab, alert }: { add?: string; tab?: Tab; alert?: string }) {
  const t = useT();
  const router = useRouter();
  // Back on the portfolio and benchmark of last time: both are read before anything is loaded.
  const [savedPortfolio, savePortfolio] = useRemembered(PORTFOLIO_KEY);
  const [benchmark, saveBenchmark] = useRemembered(BENCHMARK_KEY);
  const [tab, setTab] = useState<Tab>(alert ? "alerts" : (firstTab ?? "portfolio"));
  const section = TABS.find((x) => x.id === tab) ?? TABS[0];
  const [editing, setEditing] = useState<Transaction | { portfolio_id: number; symbol?: string }>();
  const [managing, setManaging] = useState<Portfolio | "new">();

  const { data: list, mutate: mutateList } = useSWR<PortfolioList>("/api/stocks/portfolios", fetcher);
  const portfolios = list?.portfolios;
  const shown = portfolios?.find((p) => p.id === Number(savedPortfolio));
  const query = new URLSearchParams({ ...(shown ? { portfolio: String(shown.id) } : {}), ...(benchmark ? { benchmark } : {}) });
  const wanted = !("render" in section) && savedPortfolio !== undefined && benchmark !== undefined && !!list;
  const { data, mutate, error, isLoading } = useSWR<StocksData>(wanted ? `/api/stocks?${query}` : null, fetcher, { keepPreviousData: true });
  const changed = () => void Promise.all([mutate(), mutateList()]);

  // Arriving from a stock's page to record a trade in it.
  const firstPortfolio = portfolios?.[0]?.id;
  useEffect(() => {
    if (add && firstPortfolio) setEditing((e) => e ?? { portfolio_id: firstPortfolio, symbol: add });
  }, [add, firstPortfolio]);

  const showPortfolio = (id: number | undefined) => savePortfolio(id === undefined ? null : String(id));
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
        {portfolios && (
          <button type="button" onClick={() => setEditing({ portfolio_id: shown?.id ?? portfolios[0].id })} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
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
        {portfolios && (
          <>
            <PortfolioSelect
              portfolios={portfolios}
              value={shown?.id ?? null}
              onChange={(id) => showPortfolio(id ?? undefined)}
              all={portfolios.length > 1 ? t("All portfolios") : undefined}
              label={t("Portfolio")}
              className={`${inputBase} w-48 font-medium`}
            />
            {(shown ?? (portfolios.length === 1 ? portfolios[0] : undefined)) && (
              <IconButton label="Edit portfolio" onClick={() => setManaging(shown ?? portfolios[0])}>
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

      {"render" in section ? (
        portfolios && section.render({ portfolios, shown, alert, changed })
      ) : !data || !portfolios ? (
        <p className="text-muted">{isLoading || !list ? t("Loading…") : ""}</p>
      ) : (
        <TradesSection tab={section.id} data={data} onBenchmark={saveBenchmark} onOpen={setEditing} onFirst={() => setEditing({ portfolio_id: shown?.id ?? portfolios[0].id })} />
      )}

      {editing && portfolios && <TransactionDialog transaction={editing} portfolios={portfolios} onSaved={changed} onClose={closeEditing} />}
      {managing && portfolios && (
        <PortfolioDialog
          portfolio={managing === "new" ? undefined : managing}
          canDelete={portfolios.length > 1}
          onSaved={(saved, removed) => {
            // A new portfolio is the one to look at; a deleted one can't be.
            if (managing === "new") showPortfolio(saved.portfolios[saved.portfolios.length - 1].id);
            else if (removed) showPortfolio(undefined);
            changed();
          }}
          onClose={() => setManaging(undefined)}
        />
      )}
    </main>
  );
}

interface SectionProps {
  tab: TradesTab;
  data: StocksData;
  onBenchmark: (symbol: string) => void;
  onOpen: (t: Transaction) => void;
  onFirst: () => void;
}

/** One of the sections about recorded trades, which invite a first one when there are none. */
function TradesSection({ tab, data, onBenchmark, onOpen, onFirst }: SectionProps) {
  const t = useT();
  if (!data.transactions.length)
    return (
      <div className="glass flex flex-col items-center gap-3 rounded-3xl p-10 text-center">
        <p className="text-muted">{t("Record what you bought to see your portfolio: its value, its gains and its dividends follow from there.")}</p>
        <button type="button" onClick={onFirst} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("Add your first transaction")}
        </button>
      </div>
    );
  if (tab === "transactions") return <TransactionsTab data={data} onOpen={onOpen} />;
  if (tab === "dividends") return <DividendsTab data={data} />;
  return <PortfolioTab data={data} onBenchmark={onBenchmark} />;
}
