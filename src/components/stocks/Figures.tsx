"use client";

import { useState } from "react";
import type { Fundamentals, Research } from "@/lib/stocks/types";
import { periodName, seriesOf, type Format, type Period, type SymbolFacts } from "@/lib/stocks/metrics";
import { msg } from "@/i18n";
import { number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Bars, type BarGroup } from "../charts/Bars";
import { factsOf } from "./CompanyFacts";
import { figure } from "./format";
import { Card, Choice } from "./parts";

/** One chart of the grid: its title, its series (each a measure from the catalogue), and how a value is written. */
interface Chart {
  title: string;
  series: { name: string; color: string; measure: string }[];
  format: Format;
}

const one = (title: string, measure: string, color: string, format: Format): Chart => ({ title, series: [{ name: title, color, measure }], format });

const CHARTS: Chart[] = [
  one(msg("Revenue"), "TotalRevenue", "var(--series-1)", "amount"),
  one(msg("Net income"), "NetIncome", "var(--series-3)", "amount"),
  one(msg("Earnings per share"), "DilutedEPS", "var(--series-7)", "share"),
  one(msg("Free cash flow"), "FreeCashFlow", "var(--series-4)", "amount"),
  {
    title: msg("Margins"),
    series: [
      { name: msg("Gross"), color: "var(--series-1)", measure: "grossMargin" },
      { name: msg("Operating"), color: "var(--series-2)", measure: "operatingMargin" },
      { name: msg("Net"), color: "var(--series-3)", measure: "netMargin" },
    ],
    format: "percent",
  },
  one(msg("EBITDA"), "EBITDA", "var(--series-5)", "amount"),
  {
    title: msg("Cash and debt"),
    series: [
      { name: msg("Cash"), color: "var(--series-3)", measure: "CashAndCashEquivalents" },
      { name: msg("Debt"), color: "var(--series-8)", measure: "TotalDebt" },
    ],
    format: "amount",
  },
  one(msg("Shares outstanding"), "DilutedAverageShares", "var(--series-2)", "count"),
  one(msg("Return on equity"), "roe", "var(--series-7)", "percent"),
  one(msg("Return on invested capital"), "roic", "var(--series-6)", "percent"),
  one(msg("Revenue growth"), "revenueGrowth", "var(--series-1)", "percent"),
  one(msg("Net debt / EBITDA"), "netDebtToEbitda", "var(--series-8)", "ratio"),
  {
    title: msg("Investment and returns to shareholders"),
    series: [
      { name: msg("Capital expenditure"), color: "var(--series-5)", measure: "CapitalExpenditure" },
      { name: msg("Dividends paid"), color: "var(--series-3)", measure: "CashDividendsPaid" },
      { name: msg("Share buybacks"), color: "var(--series-2)", measure: "RepurchaseOfCapitalStock" },
    ],
    format: "amount",
  },
];

/** The chart's bars: one group per period that has every figure the chart needs. */
function groupsOf(chart: Chart, facts: SymbolFacts, period: Period): BarGroup[] {
  const series = chart.series.map((s) => new Map(seriesOf(s.measure, facts, period).map((p) => [p.day, p.value])));
  return [...series[0].keys()].flatMap((day) => {
    const values = series.map((s) => s.get(day));
    return values.every((v): v is number => v !== undefined) ? [{ label: periodName(day, period), values }] : [];
  });
}

/** The company's results, a small chart per figure, by year or by quarter. */
export function Figures({ research }: { research: Research }) {
  const t = useT();
  const f: Fundamentals | null = research.fundamentals;
  const quarters = f ? Object.keys(f.quarterly).length > 0 : false;
  const [period, setPeriod] = useState<Period>("annual");
  const currency = f?.currency ?? "";
  const facts = factsOf(research);
  const charts = CHARTS.map((c) => ({ chart: c, groups: groupsOf(c, facts, quarters ? period : "annual") })).filter((c) => c.groups.length > 0);
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
            <Bars groups={groups} series={chart.series.map((s) => ({ name: t(s.name), color: s.color }))} format={(v) => figure(v, chart.format, currency)} ariaLabel={t(chart.title)} />
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
