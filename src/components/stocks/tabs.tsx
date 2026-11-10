"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { StocksData, Transaction, WatchQuote } from "@/lib/stocks/types";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Bars } from "../charts/Bars";
import { DeleteButton } from "../edit/controls";
import { asLocal } from "@/lib/day";
import { cash, percent, quoted, shares, stockHref, tone } from "./format";
import { Card, Spark, Stat } from "./parts";
import { SymbolSearch } from "./SymbolSearch";

const th = "px-3 py-2 text-right font-medium first:text-left";
const td = "px-3 py-2 text-right tabular-nums first:text-left";

/** Every buy and sell, latest first; a row opens it for editing. */
export function TransactionsTab({ data, onOpen }: { data: StocksData; onOpen: (t: Transaction) => void }) {
  const t = useT();
  const portfolioName = new Map(data.portfolios.map((p) => [p.id, p.name]));
  const several = data.portfolio === null && data.portfolios.length > 1;
  if (!data.transactions.length) return <p className="glass rounded-3xl p-8 text-center text-muted">{t("No transactions yet.")}</p>;
  return (
    <div className="glass overflow-x-auto rounded-3xl p-2">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th scope="col" className={th}>{t("Date")}</th>
            <th scope="col" className={`${th} !text-left`}>{t("Type")}</th>
            <th scope="col" className={`${th} !text-left`}>{t("Symbol")}</th>
            <th scope="col" className={th}>{t("Shares")}</th>
            <th scope="col" className={th}>{t("Price")}</th>
            <th scope="col" className={th}>{t("Fees")}</th>
            <th scope="col" className={th}>{t("Total")}</th>
            {several && <th scope="col" className={`${th} !text-left`}>{t("Portfolio")}</th>}
          </tr>
        </thead>
        <tbody>
          {data.transactions.map((x) => {
            const total = x.quantity * x.price + (x.kind === "buy" ? x.fees : -x.fees);
            return (
              <tr key={x.id} onClick={() => onOpen(x)} className="cursor-pointer border-t border-line hover:bg-hover">
                <td className={td}>
                  <button type="button" className="hover:text-accent" aria-label={t("Edit the transaction of {date}", { date: dateOnly(asLocal(x.date)) })}>
                    {dateOnly(asLocal(x.date))}
                  </button>
                </td>
                <td className={`${td} !text-left ${x.kind === "buy" ? "" : "text-[var(--warn)]"}`}>{x.kind === "buy" ? t("Buy") : t("Sell")}</td>
                <td className={`${td} !text-left font-semibold`}>{x.symbol}</td>
                <td className={td}>{shares(x.quantity)}</td>
                <td className={td}>{quoted(x.price, x.currency)}</td>
                <td className={td}>{x.fees ? quoted(x.fees, x.currency) : "–"}</td>
                <td className={td}>{quoted(total, x.currency)}</td>
                {several && <td className={`${td} !text-left text-muted`}>{portfolioName.get(x.portfolio_id)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Dividends received, worked out from the shares held on each ex-dividend day. */
export function DividendsTab({ data }: { data: StocksData }) {
  const t = useT();
  const { currency } = data;
  const year = String(new Date().getFullYear());
  const thisYear = data.dividendYears.find((y) => y.year === year)?.amount ?? 0;
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const lastTwelveMonths = data.dividendList.filter((d) => d.day > yearAgo).reduce((s, d) => s + d.amount, 0);
  const yieldOnCost = data.cost > 0 ? (lastTwelveMonths / data.cost) * 100 : null;
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label={t("Dividend figures")}>
        <Stat label={t("Received in all")} value={cash(data.dividends, currency)} />
        <Stat label={t("Received in {year}", { year })} value={cash(thisYear, currency)} />
        <Stat label={t("Yield on cost, last 12 months")} value={percent(yieldOnCost, false)} />
      </section>
      <Card title={t("Dividends per year")}>
        {data.dividendYears.length ? (
          <Bars groups={data.dividendYears.map((y) => ({ label: y.year, values: [y.amount] }))} series={[{ name: t("Dividends"), color: "var(--series-3)" }]} format={(v) => cash(v, currency)} ariaLabel={t("Dividends received per year")} />
        ) : (
          <p className="py-4 text-center text-sm text-muted">{t("No dividends yet.")}</p>
        )}
        <p className="text-xs text-muted">{t("Before tax, worked out from the shares you held on each ex-dividend day; what your broker paid may differ a little.")}</p>
      </Card>
      {data.dividendList.length > 0 && (
        <Card title={t("Payments")}>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {data.dividendList.slice(0, 60).map((d) => (
              <li key={`${d.symbol}-${d.day}`} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  <Link href={stockHref(d.symbol)} className="font-semibold hover:text-accent">
                    {d.symbol}
                  </Link>{" "}
                  <span className="text-xs text-muted">{dateOnly(asLocal(d.day))}</span>
                </span>
                <span className="shrink-0 tabular-nums">{cash(d.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

const WATCH_URL = "/api/stocks/watch";

/** Symbols to keep an eye on, without owning them. */
export function WatchTab() {
  const t = useT();
  const { data, mutate, error } = useSWR<WatchQuote[]>(WATCH_URL, fetcher);
  const [failure, setFailure] = useState<string>();
  const change = async (work: Promise<unknown>) => {
    setFailure(undefined);
    await work.catch((e: Error) => setFailure(e.message));
    await mutate();
  };
  const problem = failure ?? (error as Error | undefined)?.message;
  return (
    <>
      <div className="max-w-md">
        <SymbolSearch placeholder={t("Add a share, fund or index to watch")} onPick={(hit) => void change(sendJson(WATCH_URL, "POST", { symbol: hit.symbol }))} />
      </div>
      {problem && <p role="alert" className="text-sm text-[var(--err)]">{problem}</p>}
      {data?.length === 0 && <p className="glass rounded-3xl p-8 text-center text-muted">{t("Nothing watched yet.")}</p>}
      {data && data.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((q) => (
            <li key={q.symbol} className="glass flex items-center gap-3 rounded-3xl p-4">
              <Link href={stockHref(q.symbol)} className="group flex min-w-0 flex-1 flex-col">
                <span className="font-semibold group-hover:text-accent">{q.symbol}</span>
                <span className="truncate text-xs text-muted">{q.name}</span>
              </Link>
              <Spark values={q.closes} />
              <div className="w-24 shrink-0 text-right text-sm tabular-nums">
                {q.price === null ? <span className="text-muted">{t("no price")}</span> : quoted(q.price, q.currency)}
                <div className={`text-xs ${tone(q.change)}`}>{percent(q.change)}</div>
              </div>
              <DeleteButton label={t("Stop watching {symbol}", { symbol: q.symbol })} onConfirm={() => void change(sendJson(`${WATCH_URL}?symbol=${encodeURIComponent(q.symbol)}`, "DELETE"))} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
