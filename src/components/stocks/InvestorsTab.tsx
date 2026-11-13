"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Landmark } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { InvestorData, InvestorHolding } from "@/lib/stocks/investors";
import { INVESTORS } from "@/lib/stocks/investors/list";
import { useRemembered } from "@/lib/useRemembered";
import { dateOnly, number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { asLocal } from "@/lib/day";
import { inputBase } from "../edit/FieldInput";
import { big, percent, shares, stockHref } from "./format";
import { Card, Stat } from "./parts";
import { SymbolIcon } from "./SymbolIcon";

const INVESTOR_KEY = "page.stocks.investor";
const usd = (n: number) => `${big(n)} $`;

/** How a holding moved since the quarter before. */
function Change({ h }: { h: InvestorHolding }) {
  const t = useT();
  if (h.change === "new") return <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">{t("New")}</span>;
  if (h.change === "same" || h.sharesChange === null) return <span className="text-xs text-muted">–</span>;
  return <span className={`text-xs tabular-nums ${h.change === "added" ? "text-[var(--ok)]" : "text-[var(--err)]"}`}>{percent(h.sharesChange)}</span>;
}

/**
 * What well-known investors hold, from the 13F reports they file with the SEC each quarter: their
 * largest positions, what changed since the quarter before, and what you hold of the same.
 */
export function InvestorsTab() {
  const t = useT();
  const [saved, save] = useRemembered(INVESTOR_KEY);
  const cik = Number(saved) || INVESTORS[0].cik;
  const [other, setOther] = useState("");
  // Wait for the investor of last time rather than load the first one too.
  const { data, error, isLoading } = useSWR<InvestorData>(saved !== undefined ? `/api/stocks/investors?cik=${cik}` : null, fetcher, { shouldRetryOnError: false, keepPreviousData: true });
  const known = INVESTORS.some((i) => i.cik === cik);
  const overlap = data?.holdings.filter((h) => h.held) ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select value={known ? cik : ""} onChange={(e) => e.target.value && save(e.target.value)} aria-label={t("Investor")} className={`${inputBase} w-72 font-medium`}>
          {!known && <option value="">{data?.name ?? t("Other filer")}</option>}
          {INVESTORS.map((i) => (
            <option key={i.cik} value={i.cik}>
              {i.manager} · {i.fund}
            </option>
          ))}
        </select>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(other) > 0) save(String(Number(other)));
          }}
        >
          <input inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value.replace(/\D/g, ""))} placeholder={t("Any filer's CIK")} aria-label={t("Any filer's CIK")} className={`${inputBase} w-36`} />
          <button type="submit" disabled={!other} className="rounded-full px-3 py-1.5 text-sm text-accent hover:bg-hover disabled:opacity-40">
            {t("Show")}
          </button>
        </form>
      </div>

      {error && <p role="alert" className="rounded-xl bg-[var(--warn)]/15 px-3 py-2 text-sm text-[var(--warn)]">{(error as Error).message}</p>}
      {!data && !error && <p className="text-muted">{isLoading ? t("Reading the SEC's reports…") : ""}</p>}

      {data && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("Investor figures")}>
            <Stat label={data.manager ?? t("Filer")} value={INVESTORS.find((i) => i.cik === data.cik)?.fund ?? data.name} />
            <Stat label={t("Holdings at the end of {date}", { date: dateOnly(asLocal(data.period)) })} value={usd(data.total)} note={t("Filed {date}", { date: dateOnly(asLocal(data.filed)) })} />
            <Stat label={t("Positions")} value={number(data.count)} />
            <Stat label={t("You hold too")} value={number(overlap.length)} note={overlap.map((h) => h.symbol).join(", ") || undefined} />
          </section>

          <Card title={t("Largest holdings")}>
            <p className="text-xs text-muted">
              {t("US-listed holdings, as reported to the SEC (13F) up to 45 days after the quarter: what they held then, not today.")}
              {data.previousPeriod && ` ${t("Changes against {date}.", { date: dateOnly(asLocal(data.previousPeriod)) })}`}
            </p>
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="px-2 py-1 font-medium">{t("Company")}</th>
                    <th className="px-2 py-1 text-right font-medium">{t("Value")}</th>
                    <th className="px-2 py-1 text-right font-medium">{t("Weight")}</th>
                    <th className="px-2 py-1 text-right font-medium">{t("Shares")}</th>
                    <th className="px-2 py-1 text-right font-medium">{t("Change")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.holdings.map((h) => (
                    <tr key={`${h.cusip}:${h.putCall ?? ""}`} className="border-t border-line">
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-2">
                          {h.symbol ? <SymbolIcon symbol={h.symbol} size={22} /> : <Landmark className="h-[22px] w-[22px] p-0.5 text-muted" />}
                          {h.symbol ? (
                            <Link href={stockHref(h.symbol)} className="font-semibold hover:text-accent">
                              {h.symbol}
                            </Link>
                          ) : null}
                          <span className={`truncate ${h.symbol ? "text-xs text-muted" : "font-medium"}`}>
                            {h.issuer}
                            {h.putCall && ` (${h.putCall === "Put" ? t("put options") : t("call options")})`}
                          </span>
                          {h.held && <span className="shrink-0 rounded-full bg-[var(--ok)]/15 px-2 py-0.5 text-[11px] text-[var(--ok)]">{t("You hold it")}</span>}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{usd(h.value)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{percent(h.weight, false)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">{shares(h.shares)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Change h={h} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.count > data.holdings.length && <p className="text-xs text-muted">{t("{n} smaller positions not shown.", { n: data.count - data.holdings.length })}</p>}
          </Card>

          {data.sold.length > 0 && (
            <Card title={t("Sold entirely")}>
              <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {data.sold.map((s) => (
                  <li key={`${s.issuer}:${s.title}:${s.putCall ?? ""}`} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">{s.issuer}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{t("was {amount}", { amount: usd(s.value) })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
