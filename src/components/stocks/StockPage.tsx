"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus, Star } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { RANGES, type Range, type Research } from "@/lib/stocks/types";
import { msg } from "@/i18n";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { AppHeader } from "../AppHeader";
import { LineChart } from "../charts/LineChart";
import { Figures } from "./Figures";
import { big, percent, quoted, shares, tone } from "./format";
import { Card, Choice } from "./parts";

const RANGE_LABELS: Record<Range, string> = { "1m": msg("1M"), "6m": msg("6M"), ytd: msg("YTD"), "1y": msg("1Y"), "5y": msg("5Y"), max: msg("Max") };

/** One line of the key figures: nothing shows for a figure Yahoo doesn't have. */
function Fact({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** A closer look at one share, fund or index: its price over time, its key figures, and the company's results. */
export function StockPage({ symbol }: { symbol: string }) {
  const t = useT();
  const [range, setRange] = useState<Range>("1y");
  const url = `/api/stocks/symbol/${encodeURIComponent(symbol)}?range=${range}`;
  const { data, mutate, error } = useSWR<Research>(url, fetcher, { keepPreviousData: true });
  const back = { href: "/stocks", label: "Stocks" };

  if (!data) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
        <AppHeader title={symbol} back={back} />
        {error ? <p className="text-[var(--err)]">{(error as Error).message}</p> : <p className="text-muted">{t("Loading…")}</p>}
      </main>
    );
  }

  const f = data.fundamentals;
  const tr = f?.trailing ?? {};
  const ratio = (n: number | undefined) => (n === undefined || !(n > 0) ? null : n.toFixed(1));
  const amount = (n: number | undefined) => (n === undefined ? null : `${big(n)} ${f?.currency ?? ""}`.trim());
  const first = data.chart.closes[0];
  const over = first ? ((data.price - first) / first) * 100 : null;
  const last = <T,>(xs: T[] | undefined) => xs?.[xs.length - 1];
  const debt = last(f?.annual.TotalDebt)?.value;
  const cashHeld = last(f?.annual.CashAndCashEquivalents)?.value;

  const toggleWatch = async () => {
    await (data.watched ? sendJson(`/api/stocks/watch?symbol=${encodeURIComponent(data.symbol)}`, "DELETE") : sendJson("/api/stocks/watch", "POST", { symbol: data.symbol })).catch(() => {});
    await mutate();
  };

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <AppHeader title={data.name} back={back} subtitle={[data.symbol, data.exchange, data.sector, data.industry].filter(Boolean).join(" · ")}>
        <button type="button" onClick={toggleWatch} aria-pressed={data.watched} className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm text-muted hover:bg-hover hover:text-fg aria-pressed:text-accent">
          <Star className="h-4 w-4" fill={data.watched ? "currentColor" : "none"} /> {data.watched ? t("Watching") : t("Watch")}
        </button>
        <Link href={`/stocks?add=${encodeURIComponent(data.symbol)}`} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("New transaction")}
        </Link>
      </AppHeader>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card
          title={t("Price")}
          action={<Choice label={t("Period")} value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r, label: t(RANGE_LABELS[r]) }))} />}
        >
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-3xl font-bold tracking-tight tabular-nums">{quoted(data.price, data.currency)}</span>
            <span className={`text-sm tabular-nums ${tone(data.change)}`}>{t("{pct} today", { pct: percent(data.change) })}</span>
            <span className={`text-sm tabular-nums ${tone(over)}`}>{t("{pct} over the period", { pct: percent(over) })}</span>
          </div>
          <LineChart
            x={data.chart.days.map((d) => Date.parse(d))}
            series={[{ name: data.symbol, color: over !== null && over < 0 ? "var(--err)" : "var(--ok)", values: data.chart.closes }]}
            height={280}
            fit
            area
            formatX={dateOnly}
            format={(v) => quoted(v, data.currency)}
            ariaLabel={t("Price of {name} over the period", { name: data.name })}
          />
        </Card>

        <div className="flex flex-col gap-6">
          <Card title={t("Key figures")}>
            <dl>
              <Fact label={t("Market value")} value={amount(tr.MarketCap)} />
              <Fact label={t("Enterprise value")} value={amount(tr.EnterpriseValue)} />
              <Fact label={t("Price / earnings")} value={ratio(tr.PeRatio)} />
              <Fact label={t("Price / sales")} value={ratio(tr.PsRatio)} />
              <Fact label={t("Price / book")} value={ratio(tr.PbRatio)} />
              <Fact label={t("Free cash flow yield")} value={tr.FreeCashFlow !== undefined && tr.MarketCap ? percent((tr.FreeCashFlow / tr.MarketCap) * 100, false) : null} />
              <Fact label={t("Dividend yield")} value={data.dividendYield === null ? null : percent(data.dividendYield, false)} />
              <Fact label={t("Net debt")} value={debt !== undefined && cashHeld !== undefined ? amount(debt - cashHeld) : null} />
              <Fact label={t("52-week range")} value={data.low52 !== null && data.high52 !== null ? `${quoted(data.low52, data.currency)} – ${quoted(data.high52, data.currency)}` : null} />
            </dl>
            {!f && <p className="text-xs text-muted">{t("No company figures for this one (funds, indexes and currencies have none).")}</p>}
          </Card>
          {data.holding && (
            <Card title={t("Your position")}>
              <dl>
                <Fact label={t("Shares")} value={shares(data.holding.quantity)} />
                <Fact label={t("Average cost")} value={quoted(data.holding.avgCost, data.currency)} />
                <Fact label={t("Value")} value={quoted(data.holding.quantity * data.price, data.currency)} />
                <Fact label={t("Gain")} value={percent(data.holding.gainPct)} />
              </dl>
            </Card>
          )}
        </div>
      </div>

      <Figures research={data} />
    </main>
  );
}
