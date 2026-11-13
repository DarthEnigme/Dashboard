"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Scale, X } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { rebalance, type Target } from "@/lib/stocks/rebalance";
import type { TargetsData } from "@/lib/stocks/types";
import { number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { inputBase } from "../edit/FieldInput";
import { cash, percent, shares, stockHref, tone } from "./format";
import { Card, Stat } from "./parts";
import { SymbolIcon } from "./SymbolIcon";
import { SymbolSearch } from "./SymbolSearch";

const sum = (targets: Target[]) => targets.reduce((s, t) => s + t.weight, 0);

/**
 * Target weights for the portfolio shown (or all together), and what to buy or sell to reach them.
 * The trades are worked out as you type; the targets are kept once saved. Keyed by the portfolio,
 * so a draft doesn't follow you to another one.
 */
export function RebalanceTab({ portfolio }: { portfolio: number | null }) {
  const t = useT();
  const url = `/api/stocks/targets${portfolio ? `?portfolio=${portfolio}` : ""}`;
  const { data, error, mutate } = useSWR<TargetsData>(url, fetcher);
  const [draft, setDraft] = useState<Target[]>();
  const [added, setAdded] = useState("");
  const [buyOnly, setBuyOnly] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [saving, setSaving] = useState(false);

  if (error) return <p role="alert" className="text-sm text-[var(--err)]">{(error as Error).message}</p>;
  if (!data) return <p className="text-muted">{t("Loading…")}</p>;
  const targets = draft ?? data.targets;
  const changed = draft !== undefined;
  const total = sum(targets);
  const cashIn = Math.max(0, Number(added.replace(",", ".")) || 0);
  const r = rebalance(data.holdings, targets, cashIn, buyOnly);
  const { currency } = data;
  const setWeight = (symbol: string, weight: number | null) =>
    setDraft(weight === null ? targets.filter((x) => x.symbol !== symbol) : targets.some((x) => x.symbol === symbol) ? targets.map((x) => (x.symbol === symbol ? { ...x, weight } : x)) : [...targets, { symbol, weight }]);
  const save = async () => {
    setSaving(true);
    setFailure(undefined);
    try {
      await mutate(sendJson<TargetsData>("/api/stocks/targets", "PUT", { portfolio, targets }), { revalidate: false });
      setDraft(undefined);
    } catch (e) {
      setFailure((e as Error).message);
    }
    setSaving(false);
  };
  const fromNow = () => setDraft(r.rows.filter((x) => x.value > 0).map((x) => ({ symbol: x.symbol, weight: Math.round(x.weight * 10) / 10 })));

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("Rebalancing figures")}>
        <Stat label={t("Value")} value={cash(data.value, currency)} />
        <Stat label={t("Targets set")} value={`${number(total, { maximumFractionDigits: 1 })} %`} tone={total > 100 + 1e-6 ? "text-[var(--err)]" : ""} note={t("{n} % unallocated", { n: number(r.unallocated, { maximumFractionDigits: 1 }) })} />
        <Stat label={t("To buy")} value={cash(r.rows.reduce((s, x) => s + Math.max(x.trade, 0), 0), currency)} />
        <Stat label={t("To sell")} value={cash(r.rows.reduce((s, x) => s + Math.max(-x.trade, 0), 0), currency)} />
      </section>

      <Card
        title={t("Targets")}
        action={
          <span className="flex items-center gap-2">
            {r.rows.some((x) => x.value > 0) && (
              <button type="button" onClick={fromNow} className="rounded-full px-3 py-1 text-sm text-muted hover:bg-hover hover:text-fg">
                {t("Start from today's weights")}
              </button>
            )}
            <button type="button" disabled={!changed || saving || total > 100 + 1e-6} onClick={() => void save()} className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">
              {t("Save targets")}
            </button>
          </span>
        }
      >
        <p className="text-sm text-muted">{t("The share of the portfolio each holding should be. Holdings without a target are left as they are.")}</p>
        {failure && <p role="alert" className="text-sm text-[var(--err)]">{failure}</p>}
        {data.errors.length > 0 && <p className="text-sm text-[var(--warn)]">{t("Yahoo Finance didn't answer for: {list}.", { list: data.errors.join("; ") })}</p>}
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            {t("Cash to add")}
            <input inputMode="decimal" value={added} onChange={(e) => setAdded(e.target.value)} placeholder="0" className={`${inputBase} w-32`} />
            <span className="text-muted">{currency}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={buyOnly} onChange={(e) => setBuyOnly(e.target.checked)} />
            {t("Only buy (sell nothing)")}
          </label>
        </div>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-2 py-1 font-medium">{t("Symbol")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("Value")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("Now")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("Target")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("Drift")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("Buy / sell")}</th>
                <th className="px-2 py-1 text-right font-medium">{t("Shares")}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.symbol} className="border-t border-line">
                  <td className="px-2 py-1.5">
                    <Link href={stockHref(x.symbol)} className="flex items-center gap-2 hover:text-accent">
                      <SymbolIcon symbol={x.symbol} size={22} />
                      <span className="font-semibold">{x.symbol}</span>
                      <span className="hidden truncate text-xs text-muted sm:inline">{x.name !== x.symbol ? x.name : ""}</span>
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{cash(x.value, currency)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{percent(x.weight, false)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      inputMode="decimal"
                      value={x.target ?? ""}
                      placeholder="–"
                      onChange={(e) => setWeight(x.symbol, e.target.value.trim() === "" ? null : Math.min(100, Math.max(0, Number(e.target.value.replace(",", ".")) || 0)))}
                      aria-label={t("Target for {symbol} (%)", { symbol: x.symbol })}
                      className={`${inputBase} h-8 w-20 text-right`}
                    />
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${x.target === null ? "text-muted" : ""}`}>{x.target === null ? "–" : percent(x.weight - x.target)}</td>
                  <td className={`px-2 py-1.5 text-right font-medium tabular-nums ${tone(x.trade)}`}>{x.trade ? cash(x.trade, currency, true) : "–"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted">{x.shares && x.trade ? shares(Math.round(x.shares * 100) / 100) : "–"}</td>
                  <td className="px-1">
                    {x.target !== null && (
                      <button type="button" onClick={() => setWeight(x.symbol, null)} aria-label={t("Remove the target for {symbol}", { symbol: x.symbol })} className="rounded-lg p-1 text-muted hover:bg-hover hover:text-fg">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-full max-w-xs">
            <SymbolSearch placeholder={t("Add a symbol to aim for")} onPick={(hit) => !targets.some((x) => x.symbol === hit.symbol) && setWeight(hit.symbol, 0)} />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Scale className="h-3.5 w-3.5" />
            {r.cashLeft < -0.005 ? t("These trades need {amount} more than the cash added.", { amount: cash(-r.cashLeft, currency) }) : t("Cash left after the trades: {amount}.", { amount: cash(r.cashLeft, currency) })}
          </p>
        </div>
        {changed && <p className="text-xs text-muted">{t("Prices of symbols you just added show once the targets are saved.")}</p>}
      </Card>
    </>
  );
}
