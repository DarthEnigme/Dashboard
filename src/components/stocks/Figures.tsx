"use client";

import { useState } from "react";
import type { Fundamentals, Metric, Point, Research } from "@/lib/stocks/types";
import { msg } from "@/i18n";
import { number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Bars, type BarGroup } from "../charts/Bars";
import { big, percent } from "./format";
import { Card, Choice } from "./parts";

type Period = "annual" | "quarterly";

/** One chart of the grid: its title, its series (each a reported figure or a ratio of two), and how a value is written. */
interface Chart {
  title: string;
  series: { name: string; color: string; of: Metric; over?: Metric; scale?: number }[];
  format: "amount" | "share" | "percent" | "count";
}

const CHARTS: Chart[] = [
  { title: msg("Revenue"), series: [{ name: msg("Revenue"), color: "var(--series-1)", of: "TotalRevenue" }], format: "amount" },
  { title: msg("Net income"), series: [{ name: msg("Net income"), color: "var(--series-3)", of: "NetIncome" }], format: "amount" },
  { title: msg("Earnings per share"), series: [{ name: msg("Earnings per share"), color: "var(--series-7)", of: "DilutedEPS" }], format: "share" },
  { title: msg("Free cash flow"), series: [{ name: msg("Free cash flow"), color: "var(--series-4)", of: "FreeCashFlow" }], format: "amount" },
  {
    title: msg("Margins"),
    series: [
      { name: msg("Gross"), color: "var(--series-1)", of: "GrossProfit", over: "TotalRevenue", scale: 100 },
      { name: msg("Operating"), color: "var(--series-2)", of: "OperatingIncome", over: "TotalRevenue", scale: 100 },
      { name: msg("Net"), color: "var(--series-3)", of: "NetIncome", over: "TotalRevenue", scale: 100 },
    ],
    format: "percent",
  },
  { title: msg("EBITDA"), series: [{ name: msg("EBITDA"), color: "var(--series-5)", of: "EBITDA" }], format: "amount" },
  {
    title: msg("Cash and debt"),
    series: [
      { name: msg("Cash"), color: "var(--series-3)", of: "CashAndCashEquivalents" },
      { name: msg("Debt"), color: "var(--series-8)", of: "TotalDebt" },
    ],
    format: "amount",
  },
  { title: msg("Shares outstanding"), series: [{ name: msg("Shares outstanding"), color: "var(--series-2)", of: "DilutedAverageShares" }], format: "count" },
  { title: msg("Return on equity"), series: [{ name: msg("Return on equity"), color: "var(--series-7)", of: "NetIncome", over: "StockholdersEquity", scale: 100 }], format: "percent" },
];

/** "2025" for a fiscal year, "Q3 25" for a quarter. */
const periodName = (day: string, period: Period) => (period === "annual" ? day.slice(0, 4) : `Q${Math.ceil(Number(day.slice(5, 7)) / 3)} ${day.slice(2, 4)}`);

/** The chart's bars: one group per period that has every figure the chart needs. */
function groupsOf(chart: Chart, figures: Partial<Record<Metric, Point[]>>, period: Period): BarGroup[] {
  const at = (m: Metric, day: string) => figures[m]?.find((p) => p.day === day)?.value;
  return (figures[chart.series[0].of] ?? []).flatMap((p) => {
    const values = chart.series.map((s) => {
      const top = at(s.of, p.day);
      const bottom = s.over ? at(s.over, p.day) : 1;
      return top === undefined || !bottom ? undefined : (top / bottom) * (s.scale ?? 1);
    });
    return values.every((v): v is number => v !== undefined) ? [{ label: periodName(p.day, period), values }] : [];
  });
}

/** The company's results, a small chart per figure, by year or by quarter. */
export function Figures({ research }: { research: Research }) {
  const t = useT();
  const f: Fundamentals | null = research.fundamentals;
  const quarters = f ? Object.keys(f.quarterly).length > 0 : false;
  const [period, setPeriod] = useState<Period>("annual");
  const figures = f?.[quarters ? period : "annual"] ?? {};
  const currency = f?.currency ?? "";
  const write: Record<Chart["format"], (v: number) => string> = {
    amount: (v) => `${big(v)} ${currency}`.trim(),
    share: (v) => `${number(v, { maximumFractionDigits: 2 })} ${currency}`.trim(),
    percent: (v) => percent(v, false),
    count: big,
  };
  const charts = CHARTS.map((c) => ({ chart: c, groups: groupsOf(c, figures, quarters ? period : "annual") })).filter((c) => c.groups.length > 0);
  const dividends = research.dividends.slice(-10);

  if (!charts.length && !dividends.length) return null;
  return (
    <section className="flex flex-col gap-4" aria-label={t("Company figures")}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t("Company figures")}</h2>
          {currency && currency !== research.currency.toUpperCase() && <p className="text-xs text-muted">{t("Reported in {currency}; the share is quoted in {quote}.", { currency, quote: research.currency })}</p>}
        </div>
        {quarters && (
          <Choice
            label={t("Period")}
            value={period}
            onChange={setPeriod}
            options={[
              { id: "annual", label: t("Yearly") },
              { id: "quarterly", label: t("Quarterly") },
            ]}
          />
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {charts.map(({ chart, groups }) => (
          <Card key={chart.title} title={t(chart.title)}>
            <Bars groups={groups} series={chart.series.map((s) => ({ name: t(s.name), color: s.color }))} format={write[chart.format]} ariaLabel={t(chart.title)} />
          </Card>
        ))}
        {dividends.length > 0 && (
          <Card title={t("Dividend per share")}>
            <Bars
              groups={dividends.map((d) => ({ label: d.year, values: [d.amount] }))}
              series={[{ name: t("Dividend per share"), color: "var(--series-3)" }]}
              format={(v) => `${number(v, { maximumFractionDigits: 2 })} ${research.currency}`}
              ariaLabel={t("Dividend per share")}
            />
          </Card>
        )}
      </div>
    </section>
  );
}
