"use client";

import { useRef } from "react";
import Link from "next/link";
import type { CompareData, CompareSymbol } from "@/lib/stocks/types";
import { divideSeries, latestOf, measure, seriesOf, type Period } from "@/lib/stocks/metrics";
import { msg } from "@/i18n";
import { number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Bars } from "../../charts/Bars";
import { ChartExport } from "../../charts/ChartExport";
import { Scatter } from "../../charts/Scatter";
import { inputBase } from "../../edit/FieldInput";
import { figure, stockHref } from "../format";
import { Card } from "../parts";
import { SymbolIcon } from "../SymbolIcon";

const color = (i: number) => `var(--series-${(i % 8) + 1})`;

/** Every symbol on every chosen figure, today; the best of each row is marked. */
export function TableView({ data, measures }: { data: CompareData; measures: string[] }) {
  const t = useT();
  const rows = measures.flatMap((id) => (measure(id) ? [measure(id)!] : []));
  return (
    <Card title={t("Side by side")}>
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="px-3 py-2 text-left font-medium">{t("Figure")}</th>
              {data.symbols.map((s) => (
                <th key={s.symbol} className="px-3 py-2 text-right font-medium">
                  <Link href={stockHref(s.symbol)} className="inline-flex items-center gap-1.5 hover:text-accent">
                    <SymbolIcon symbol={s.symbol} size={18} />
                    {s.symbol}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="px-3 py-2 text-muted">{t(m.label)}</td>
                {data.symbols.map((s) => (
                  <td key={s.symbol} className="px-3 py-2 text-right tabular-nums">
                    {figure(latestOf(m.id, s), m.format, m.format === "share" ? s.currency : (s.fundamentals?.currency ?? ""))}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-line">
              <td className="px-3 py-2 text-muted">{t("Beta")}</td>
              {data.symbols.map((s) => (
                <td key={s.symbol} className="px-3 py-2 text-right tabular-nums">
                  {s.beta === null ? "–" : number(s.beta, { maximumFractionDigits: 2 })}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Two chosen figures as the axes, each symbol a point. */
export function ScatterView({ data, x, y, onAxes, measures }: { data: CompareData; x: string; y: string; onAxes: (x: string, y: string) => void; measures: string[] }) {
  const t = useT();
  const chart = useRef<HTMLDivElement>(null);
  const mx = measure(x);
  const my = measure(y);
  const points = data.symbols.flatMap((s, i) => {
    const vx = latestOf(x, s);
    const vy = latestOf(y, s);
    return vx === null || vy === null ? [] : [{ id: s.symbol, label: s.symbol, x: vx, y: vy, color: color(i) }];
  });
  const axis = (value: string, onChange: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${inputBase} h-8 py-0 text-sm`}>
      {measures.map((id) => (
        <option key={id} value={id}>
          {t(measure(id)?.label ?? id)}
        </option>
      ))}
    </select>
  );
  return (
    <Card
      title={t("Scatter")}
      action={
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {axis(x, (v) => onAxes(v, y), t("Across"))} × {axis(y, (v) => onAxes(x, v), t("Up"))}
          <ChartExport chart={chart} name={`scatter-${x}-${y}`} />
        </div>
      }
    >
      <div ref={chart}>
        {mx && my && points.length ? (
          <Scatter points={points} xLabel={t(mx.label)} yLabel={t(my.label)} formatX={(v) => figure(v, mx.format)} formatY={(v) => figure(v, my.format)} ariaLabel={t("{y} against {x}", { x: t(mx.label), y: t(my.label) })} />
        ) : (
          <p className="py-8 text-center text-sm text-muted">{t("Pick two figures the symbols have.")}</p>
        )}
      </div>
    </Card>
  );
}

/** One side of a custom ratio: a figure of a symbol, or of the portfolio. */
export interface Operand {
  of: string;
  measure: string;
}
export const PORTFOLIO = "portfolio";
export const PORTFOLIO_MEASURES = ["value", "cost", "gain", "dividends", "realized"] as const;
const PORTFOLIO_LABELS: Record<(typeof PORTFOLIO_MEASURES)[number], string> = { value: msg("Value"), cost: msg("Invested"), gain: msg("Unrealised gain"), dividends: msg("Dividends"), realized: msg("Realised gain") };
const portfolioLabel = (m: string) => PORTFOLIO_LABELS[m as (typeof PORTFOLIO_MEASURES)[number]] ?? m;

export const parseOperand = (raw: string | null): Operand | undefined => {
  const [of, m] = (raw ?? "").split(":");
  return of && m ? { of, measure: m } : undefined;
};
export const writeOperand = (o: Operand) => `${o.of}:${o.measure}`;

/** A ratio of any two figures: two companies, a company and the portfolio, or one company's own. Over time when both sides have periods. */
export function RatioView({ data, a, b, period, onChange, measures }: { data: CompareData; a?: Operand; b?: Operand; period: Period; onChange: (a: Operand, b: Operand) => void; measures: string[] }) {
  const t = useT();
  const chart = useRef<HTMLDivElement>(null);
  const first = data.symbols[0]?.symbol ?? PORTFOLIO;
  const top = a ?? { of: first, measure: measures[0] ?? "NetIncome" };
  const bottom = b ?? { of: data.symbols[1]?.symbol ?? first, measure: measures[1] ?? measures[0] ?? "TotalRevenue" };
  const sym = (s: string) => data.symbols.find((x) => x.symbol === s);
  const portfolioValue = (m: string) => (data.portfolio ? (data.portfolio[m as (typeof PORTFOLIO_MEASURES)[number]] ?? null) : null);
  const latest = (o: Operand) => (o.of === PORTFOLIO ? portfolioValue(o.measure) : sym(o.of) ? latestOf(o.measure, sym(o.of) as CompareSymbol) : null);
  const series = (o: Operand) => (o.of === PORTFOLIO || !sym(o.of) ? [] : seriesOf(o.measure, sym(o.of)!, period));
  const over = divideSeries(series(top), series(bottom), period);
  const now = (() => {
    const x = latest(top);
    const y = latest(bottom);
    return x === null || !y ? null : x / y;
  })();
  const name = (o: Operand) => `${o.of === PORTFOLIO ? t("Portfolio") : o.of} · ${t(o.of === PORTFOLIO ? portfolioLabel(o.measure) : (measure(o.measure)?.label ?? o.measure))}`;

  const picker = (o: Operand, set: (o: Operand) => void, label: string) => (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <select value={o.of} onChange={(e) => set({ of: e.target.value, measure: e.target.value === PORTFOLIO ? "value" : o.of === PORTFOLIO ? (measures[0] ?? "NetIncome") : o.measure })} aria-label={t("Of")} className={`${inputBase} h-8 py-0 text-sm`}>
        {data.symbols.map((s) => (
          <option key={s.symbol} value={s.symbol}>
            {s.symbol}
          </option>
        ))}
        {data.portfolio && <option value={PORTFOLIO}>{t("Portfolio")}</option>}
      </select>
      <select value={o.measure} onChange={(e) => set({ ...o, measure: e.target.value })} aria-label={t("Figure")} className={`${inputBase} h-8 py-0 text-sm`}>
        {(o.of === PORTFOLIO ? PORTFOLIO_MEASURES.map((m) => ({ id: m, label: t(PORTFOLIO_LABELS[m]) })) : measures.map((id) => ({ id, label: t(measure(id)?.label ?? id) }))).map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Card title={t("Custom ratio")} action={<ChartExport chart={chart} name={`ratio-${writeOperand(top)}-${writeOperand(bottom)}`.replace(/[^\w-]+/g, "_")} />}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {picker(top, (o) => onChange(o, bottom), t("Above"))}
        <span className="text-lg text-muted">÷</span>
        {picker(bottom, (o) => onChange(top, o), t("Below"))}
      </div>
      <p className="text-sm">
        <span className="text-muted">{t("Today")}: </span>
        <span className="text-2xl font-bold tabular-nums">{now === null ? "–" : number(now, { maximumFractionDigits: 3 })}</span>
      </p>
      <div ref={chart}>
        {over.length > 0 ? (
          <Bars groups={over.map((p) => ({ label: p.period, values: [p.value] }))} series={[{ name: `${name(top)} ÷ ${name(bottom)}`, color: "var(--series-1)" }]} format={(v) => number(v, { maximumFractionDigits: 3 })} ariaLabel={`${name(top)} ÷ ${name(bottom)}`} />
        ) : (
          <p className="text-xs text-muted">{t("Over time when both sides are figures companies report each period.")}</p>
        )}
      </div>
    </Card>
  );
}
