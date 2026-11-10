"use client";

import { useState } from "react";
import Link from "next/link";
import { BENCHMARKS, type Position, type StocksData } from "@/lib/stocks/types";
import { msg } from "@/i18n";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Donut, type DonutSlice } from "../charts/Donut";
import { LineChart } from "../charts/LineChart";
import { inputBase } from "../edit/FieldInput";
import { cash, percent, quoted, shares, stockHref, tone } from "./format";
import { Card, Choice, Stat } from "./parts";

const PERIODS = [
  { id: "1m", label: msg("1M"), days: 31 },
  { id: "6m", label: msg("6M"), days: 183 },
  { id: "1y", label: msg("1Y"), days: 366 },
  { id: "all", label: msg("All"), days: Infinity },
] as const;
type Period = (typeof PERIODS)[number]["id"];

const SPLITS = [
  { id: "holding", label: msg("By holding") },
  { id: "sector", label: msg("By sector") },
  { id: "currency", label: msg("By currency") },
] as const;
type Split = (typeof SPLITS)[number]["id"];

/** The value over time, or the return against a benchmark, over the period chosen. */
function History({ data, onBenchmark }: { data: StocksData; onBenchmark: (symbol: string) => void }) {
  const t = useT();
  const [mode, setMode] = useState<"value" | "performance">("value");
  const [period, setPeriod] = useState<Period>("all");
  const { series, currency } = data;
  const span = PERIODS.find((p) => p.id === period)!.days;
  const cutoff = Number.isFinite(span) ? new Date(Date.now() - span * 86_400_000).toISOString().slice(0, 10) : "";
  const from = Math.max(series.days.findIndex((d) => d >= cutoff), 0);
  const cut = <T,>(xs: T[]) => xs.slice(from);
  // A return over part of the history starts again from zero at its first day.
  const rebase = (xs: (number | null)[]) => {
    const first = xs[from];
    return cut(xs).map((v) => (v === null || first === null || first === undefined ? null : ((1 + v / 100) / (1 + first / 100) - 1) * 100));
  };
  const benchmark = BENCHMARKS.find((b) => b.symbol === data.benchmark)!;

  return (
    <Card
      title={mode === "value" ? t("Value over time") : t("Performance")}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {mode === "performance" && (
            <select value={data.benchmark} onChange={(e) => onBenchmark(e.target.value)} aria-label={t("Compare with")} className={`${inputBase} h-8 py-0 text-sm`}>
              {BENCHMARKS.map((b) => (
                <option key={b.symbol} value={b.symbol}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <Choice label={t("Chart")} value={mode} onChange={setMode} options={[{ id: "value", label: t("Value") }, { id: "performance", label: t("Performance") }]} />
          <Choice label={t("Period")} value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ id: p.id, label: t(p.label) }))} />
        </div>
      }
    >
      {mode === "value" ? (
        <LineChart
          x={cut(series.days).map((d) => Date.parse(d))}
          series={[
            { name: t("Value"), color: "var(--series-1)", values: cut(series.value) },
            { name: t("Invested"), color: "var(--series-4)", values: cut(series.invested) },
          ]}
          height={260}
          formatX={dateOnly}
          format={(v) => cash(v, currency)}
          ariaLabel={t("Portfolio value and money invested over time")}
        />
      ) : (
        <>
          <LineChart
            x={cut(series.days).map((d) => Date.parse(d))}
            series={[
              { name: t("Portfolio"), color: "var(--series-1)", values: rebase(series.performance) },
              ...(series.benchmark ? [{ name: benchmark.name, color: "var(--series-2)", values: rebase(series.benchmark) }] : []),
            ]}
            height={260}
            unit=" %"
            formatX={dateOnly}
            format={(v) => percent(v)}
            ariaLabel={t("Portfolio return compared with {name}", { name: benchmark.name })}
          />
          <p className="text-xs text-muted">{t("Time-weighted: money you add or withdraw doesn't count as performance. Prices only, without dividends.")}</p>
        </>
      )}
    </Card>
  );
}

/** How the value splits: the seven largest parts, and the rest together. */
function Allocation({ positions, currency }: { positions: Position[]; currency: string }) {
  const t = useT();
  const [split, setSplit] = useState<Split>("holding");
  const key = (p: Position) => (split === "holding" ? p.symbol : split === "sector" ? (p.sector ?? t("Unclassified")) : p.currency.toUpperCase());
  const parts = [...positions.reduce((m, p) => m.set(key(p), (m.get(key(p)) ?? 0) + p.value), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const total = parts.reduce((s, [, v]) => s + v, 0);
  const rest = parts.slice(7).reduce((s, [, v]) => s + v, 0);
  const slice = (name: string, value: number, slot: number | null): DonutSlice => ({ name, value, slot, label: percent((value / (total || 1)) * 100, false) });
  const slices = [...parts.slice(0, 7).map(([name, value], i) => slice(name, value, i + 1)), ...(rest > 0 ? [slice("Other", rest, null)] : [])];

  return (
    <Card title={t("Allocation")} action={<Choice label={t("Split")} value={split} onChange={setSplit} options={SPLITS.map((s) => ({ id: s.id, label: t(s.label) }))} />}>
      <Donut slices={slices} total={cash(total, currency)} size={150} centerLabel={t("value")} empty={t("Nothing held yet.")} ariaLabel={t("Portfolio allocation")} />
    </Card>
  );
}

const th = "px-3 py-2 text-right font-medium first:text-left";
const td = "px-3 py-2 text-right tabular-nums first:text-left";

function Holdings({ positions, currency }: { positions: Position[]; currency: string }) {
  const t = useT();
  return (
    <Card title={t("Holdings")}>
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className={th}>{t("Name")}</th>
              <th scope="col" className={th}>{t("Shares")}</th>
              <th scope="col" className={th}>{t("Average cost")}</th>
              <th scope="col" className={th}>{t("Price")}</th>
              <th scope="col" className={th}>{t("Value")}</th>
              <th scope="col" className={th}>{t("Gain")}</th>
              <th scope="col" className={th}>{t("Weight")}</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.symbol} className="border-t border-line hover:bg-hover">
                <td className={td}>
                  <Link href={stockHref(p.symbol)} className="group flex flex-col">
                    <span className="font-semibold group-hover:text-accent">{p.symbol}</span>
                    <span className="max-w-56 truncate text-xs text-muted">{p.name}</span>
                  </Link>
                </td>
                <td className={td}>{shares(p.quantity)}</td>
                <td className={td}>{quoted(p.avgCost, p.currency)}</td>
                <td className={td}>
                  {quoted(p.price, p.currency)}
                  <div className={`text-xs ${tone(p.change)}`}>{p.unpriced ? t("no price") : percent(p.change)}</div>
                </td>
                <td className={td}>{cash(p.value, currency)}</td>
                <td className={`${td} ${tone(p.gain)}`}>
                  {cash(p.gain, currency, true)}
                  <div className="text-xs">{percent(p.gainPct)}</div>
                </td>
                <td className={td}>{percent(p.weight * 100, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** The portfolio at a glance: what it is worth, how it got there, what is in it. */
export function PortfolioTab({ data, onBenchmark }: { data: StocksData; onBenchmark: (symbol: string) => void }) {
  const t = useT();
  const { currency } = data;
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("Portfolio figures")}>
        <Stat label={t("Value")} value={cash(data.value, currency)} note={<span className={tone(data.dayChange)}>{t("{amount} today ({pct})", { amount: cash(data.dayChange, currency, true), pct: percent(data.dayChangePct) })}</span>} />
        <Stat label={t("Invested")} value={cash(data.cost, currency)} note={t("Cost of what you hold, fees included")} />
        <Stat label={t("Unrealised gain")} value={cash(data.gain, currency, true)} tone={tone(data.gain)} note={percent(data.gainPct)} />
        <Stat label={t("Realised gain and dividends")} value={cash(data.realized + data.dividends, currency, true)} tone={tone(data.realized + data.dividends)} note={t("{sales} on sales · {dividends} in dividends", { sales: cash(data.realized, currency, true), dividends: cash(data.dividends, currency) })} />
      </section>
      <History data={data} onBenchmark={onBenchmark} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Holdings positions={data.positions} currency={currency} />
        <Allocation positions={data.positions} currency={currency} />
      </div>
      {data.closed.length > 0 && (
        <Card title={t("Sold positions")}>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {data.closed.map((p) => (
              <li key={p.symbol} className="flex items-baseline justify-between gap-2">
                <Link href={stockHref(p.symbol)} className="min-w-0 truncate hover:text-accent">
                  <span className="font-semibold">{p.symbol}</span> <span className="text-xs text-muted">{p.name}</span>
                </Link>
                <span className={`shrink-0 tabular-nums ${tone(p.realized)}`}>{cash(p.realized, currency, true)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
