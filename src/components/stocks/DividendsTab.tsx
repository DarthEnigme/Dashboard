"use client";

import Link from "next/link";
import type { StocksData } from "@/lib/stocks/types";
import { dateOnly, formatLocale, number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Bars } from "../charts/Bars";
import { asLocal } from "@/lib/day";
import { cash, percent, stockHref } from "./format";
import { daysBefore, localDay } from "@/lib/day";
import { Card, Stat } from "./parts";

/** "Nov" for 2026-11, in the reader's language. */
const monthName = (month: string) => new Date(`${month}-01T00:00`).toLocaleDateString(formatLocale(), { month: "short" });

/** Dividends received, worked out from the shares held on each ex-dividend day; and those expected over the next year. */
export function DividendsTab({ data }: { data: StocksData }) {
  const t = useT();
  const { currency } = data;
  const year = String(new Date().getFullYear());
  const thisYear = data.dividendYears.find((y) => y.year === year)?.amount ?? 0;
  const yearAgo = daysBefore(localDay(), 365);
  const lastTwelveMonths = data.dividendList.filter((d) => d.day > yearAgo).reduce((s, d) => s + d.amount, 0);
  const yieldOnCost = data.cost > 0 ? (lastTwelveMonths / data.cost) * 100 : null;
  const { forecast } = data;
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("Dividend figures")}>
        <Stat label={t("Received in all")} value={cash(data.dividends, currency)} />
        <Stat label={t("Received in {year}", { year })} value={cash(thisYear, currency)} />
        <Stat label={t("Yield on cost, last 12 months")} value={percent(yieldOnCost, false)} />
        <Stat label={t("Expected, next 12 months")} value={cash(forecast.total, currency)} note={data.value > 0 ? t("{n} % of the value", { n: number((forecast.total / data.value) * 100, { maximumFractionDigits: 2 }) }) : undefined} />
      </section>
      {forecast.payments.length > 0 && (
        <Card title={t("Next 12 months (estimated)")}>
          <Bars groups={forecast.months.map((m) => ({ label: monthName(m.month), values: [m.amount] }))} series={[{ name: t("Expected"), color: "var(--series-2)" }]} format={(v) => cash(v, currency)} ariaLabel={t("Dividends expected per month")} />
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {forecast.payments.slice(0, 24).map((d) => (
              <li key={`${d.symbol}-${d.day}`} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  <Link href={stockHref(d.symbol)} className="font-semibold hover:text-accent">
                    {d.symbol}
                  </Link>{" "}
                  <span className="text-xs text-muted">{t("around {date}", { date: dateOnly(asLocal(d.day)) })}</span>
                </span>
                <span className="shrink-0 tabular-nums">{cash(d.amount, currency)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{t("Each dividend of the last twelve months, again a year later on the shares you hold now. Dates are ex-dividend days; companies may change what they pay.")}</p>
        </Card>
      )}
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
