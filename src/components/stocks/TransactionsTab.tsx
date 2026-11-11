"use client";

import type { StocksData, Transaction } from "@/lib/stocks/types";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { asLocal } from "@/lib/day";
import { quoted, shares } from "./format";
import { SymbolIcon } from "./SymbolIcon";

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
                <td className={`${td} !text-left font-semibold`}>
                  <span className="flex items-center gap-2">
                    <SymbolIcon symbol={x.symbol} size={22} />
                    {x.symbol}
                  </span>
                </td>
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
