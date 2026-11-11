"use client";

import { useRef } from "react";
import { BENCHMARKS, type CompareData } from "@/lib/stocks/types";
import { rebased } from "@/lib/stocks/stats";
import { msg } from "@/i18n";
import { dateOnly, number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { ChartExport } from "../../charts/ChartExport";
import { Donut, type DonutSlice } from "../../charts/Donut";
import { LineChart } from "../../charts/LineChart";
import { inputBase } from "../../edit/FieldInput";
import { cash, percent, tone } from "../format";
import { Card, Fact } from "../parts";
import { SymbolIcon } from "../SymbolIcon";

const color = (i: number) => `var(--series-${(i % 8) + 1})`;

/** Each symbol and the benchmark as 100 at the start of the range, on the benchmark's days. */
export function PerformanceView({ data, onBenchmark }: { data: CompareData; onBenchmark: (symbol: string) => void }) {
  const t = useT();
  const chart = useRef<HTMLDivElement>(null);
  const days = data.benchmark.chart.days.length ? data.benchmark.chart.days : (data.symbols[0]?.chart.days ?? []);
  const from = days[0] ?? "";
  const on = (s: { days: string[]; closes: number[] }) => {
    const r = rebased(s, from);
    const at = new Map(r.days.map((d, i) => [d, r.closes[i]]));
    let last: number | null = null;
    // A day one market was shut keeps its last close.
    return days.map((d) => (last = at.get(d) ?? last));
  };
  const series = [
    ...data.symbols.map((s, i) => ({ name: s.symbol, color: color(i), values: on(s.chart) })),
    { name: data.benchmark.name, color: "var(--fg-muted)", values: on(data.benchmark.chart) },
  ];
  return (
    <Card
      title={t("Performance")}
      action={
        <div className="flex items-center gap-2">
          <select value={data.benchmark.symbol} onChange={(e) => onBenchmark(e.target.value)} aria-label={t("Compare with")} className={`${inputBase} h-8 py-0 text-sm`}>
            {BENCHMARKS.map((b) => (
              <option key={b.symbol} value={b.symbol}>
                {b.name}
              </option>
            ))}
          </select>
          <ChartExport chart={chart} name={`performance-${data.range}`} />
        </div>
      }
    >
      <div ref={chart}>
        <LineChart x={days.map((d) => Date.parse(d))} series={series} height={300} fit formatX={dateOnly} format={(v) => number(v, { maximumFractionDigits: 1 })} ariaLabel={t("Prices as 100 at the start of the period")} />
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 text-left font-medium">{t("Symbol")}</th>
            <th className="py-1 text-right font-medium">{t("Over the period")}</th>
            <th className="py-1 text-right font-medium">{t("Volatility (a year)")}</th>
            <th className="py-1 text-right font-medium">{t("Beta")}</th>
            <th className="py-1 text-right font-medium">{t("Correlation")}</th>
          </tr>
        </thead>
        <tbody>
          {data.symbols.map((s, i) => {
            const v = series[i].values.filter((x): x is number => x !== null);
            const change = v.length ? v[v.length - 1] - 100 : null;
            return (
              <tr key={s.symbol} className="border-t border-line">
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(i) }} aria-hidden />
                    <SymbolIcon symbol={s.symbol} size={18} />
                    {s.symbol}
                  </span>
                </td>
                <td className={`py-1.5 text-right tabular-nums ${tone(change)}`}>{percent(change)}</td>
                <td className="py-1.5 text-right tabular-nums">{s.volatility === null ? "–" : percent(s.volatility, false)}</td>
                <td className="py-1.5 text-right tabular-nums">{s.beta === null ? "–" : number(s.beta, { maximumFractionDigits: 2 })}</td>
                <td className="py-1.5 text-right tabular-nums">{s.correlation === null ? "–" : number(s.correlation, { maximumFractionDigits: 2 })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

const EXPOSURES = [
  { id: "country", label: msg("By country") },
  { id: "currency", label: msg("By currency") },
  { id: "sector", label: msg("By sector") },
] as const;

/** The portfolio crossed with the market: where its money is (country, currency, sector) and how much it moves with the benchmark. */
export function MarketView({ data }: { data: CompareData }) {
  const t = useT();
  const p = data.portfolio;
  if (!p) return <p className="glass rounded-3xl p-8 text-center text-muted">{t("Record trades to see your portfolio against the market.")}</p>;
  const slices = (parts: { name: string; value: number }[]): DonutSlice[] => {
    const top = parts.slice(0, 7).map((x, i) => ({ name: x.name === "?" ? t("Unknown") : x.name, value: x.value, slot: i + 1, label: percent((x.value / (p.value || 1)) * 100, false) }));
    const rest = parts.slice(7).reduce((s, x) => s + x.value, 0);
    return rest > 0 ? [...top, { name: t("Other"), value: rest, slot: null, label: percent((rest / p.value) * 100, false) }] : top;
  };
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      <Card title={t("Against {name}", { name: data.benchmark.name })}>
        <dl>
          <Fact label={t("Value")} value={cash(p.value, p.currency)} />
          <Fact label={t("Unrealised gain")} value={`${cash(p.gain, p.currency, true)} (${percent(p.gainPct)})`} />
          <Fact label={t("Portfolio beta")} value={p.beta === null ? null : number(p.beta, { maximumFractionDigits: 2 })} />
        </dl>
        <p className="text-xs text-muted">{t("Beta over the last year, weighted by value: 1.2 means it tends to move 1.2 % when the index moves 1 %.")}</p>
        <ul className="mt-1 flex flex-col gap-1 text-sm">
          {p.holdings.map((h) => (
            <li key={h.symbol} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <SymbolIcon symbol={h.symbol} size={18} />
                {h.symbol}
              </span>
              <span className="text-muted tabular-nums">β {h.beta === null ? "–" : number(h.beta, { maximumFractionDigits: 2 })}</span>
            </li>
          ))}
        </ul>
      </Card>
      {EXPOSURES.map((e) => (
        <Card key={e.id} title={t(e.label)}>
          <Donut slices={slices(p.exposure[e.id])} total={cash(p.value, p.currency)} size={150} centerLabel={t("value")} empty={t("Nothing held yet.")} ariaLabel={t(e.label)} />
        </Card>
      ))}
    </div>
  );
}
