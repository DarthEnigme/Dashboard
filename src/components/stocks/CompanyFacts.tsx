"use client";

import type { Recommendations, Research } from "@/lib/stocks/types";
import { latestOf, measure, type SymbolFacts } from "@/lib/stocks/metrics";
import { msg } from "@/i18n";
import { dateOnly, number } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { asLocal } from "@/lib/day";
import { big, figure, percent, quoted } from "./format";
import { Card, Fact } from "./parts";

/** The research page's view of a symbol, as the measures catalogue reads it. */
export const factsOf = (r: Research): SymbolFacts => ({ symbol: r.symbol, price: r.price, fundamentals: r.fundamentals, company: r.company });

/** Ratios beyond the key figures, each worked out by the measures catalogue. */
const MORE = ["forwardPe", "peg", "evToEbitda", "roe", "roic", "netMargin", "netDebtToEbitda", "currentRatio", "payout", "revenueCagr3", "epsCagr3", "beta"];

export function MoreRatios({ research }: { research: Research }) {
  const t = useT();
  const facts = factsOf(research);
  const rows = MORE.flatMap((id) => {
    const m = measure(id)!;
    const v = latestOf(id, facts);
    return v === null ? [] : [{ id, label: m.label, value: figure(v, m.format, research.currency) }];
  });
  if (!rows.length) return null;
  return (
    <Card title={t("More ratios")}>
      <dl>
        {rows.map((r) => (
          <Fact key={r.id} label={t(r.label)} value={r.value} />
        ))}
      </dl>
    </Card>
  );
}

const VOTES: { key: keyof Recommendations; label: string; color: string }[] = [
  { key: "strongBuy", label: msg("Strong buy"), color: "var(--ok)" },
  { key: "buy", label: msg("Buy"), color: "color-mix(in oklab, var(--ok) 60%, transparent)" },
  { key: "hold", label: msg("Hold"), color: "var(--fg-muted)" },
  { key: "sell", label: msg("Sell"), color: "color-mix(in oklab, var(--err) 60%, transparent)" },
  { key: "strongSell", label: msg("Strong sell"), color: "var(--err)" },
];

/** Who the company is, what is coming, what analysts think and who holds it: Yahoo's quote summary, when it answers. */
export function CompanyFacts({ research: r }: { research: Research }) {
  const t = useT();
  const c = r.company;
  if (!c) return null;
  const share = (v: number | null) => (v === null ? null : percent(v * 100, false));
  const day = (d: string | null) => (d ? dateOnly(asLocal(d)) : null);
  const votes = c.analysts?.trend;
  const total = votes ? VOTES.reduce((s, v) => s + votes[v.key], 0) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
      {c.profile && (
        <Card title={t("Company")} className="xl:col-span-2">
          {c.profile.description && <p className="line-clamp-6 text-sm text-muted">{c.profile.description}</p>}
          <dl className="mt-2">
            <Fact label={t("Country")} value={[c.profile.city, c.profile.country].filter(Boolean).join(", ") || null} />
            <Fact label={t("Employees")} value={c.profile.employees === null ? null : number(c.profile.employees)} />
            <Fact
              label={t("Website")}
              value={
                c.profile.website ? (
                  <a href={c.profile.website} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                    {c.profile.website.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                ) : null
              }
            />
            {c.profile.officers[0] && <Fact label={c.profile.officers[0].title || t("Officer")} value={c.profile.officers[0].name} />}
          </dl>
        </Card>
      )}

      <Card title={t("Calendar")}>
        <dl>
          <Fact label={t("Next results")} value={c.calendar.earnings.length ? c.calendar.earnings.map(day).join(" – ") : null} />
          <Fact label={t("Ex-dividend day")} value={day(c.calendar.exDividend)} />
          <Fact label={t("Dividend paid")} value={day(c.calendar.dividendPaid)} />
        </dl>
        {!c.calendar.earnings.length && !c.calendar.exDividend && <p className="text-sm text-muted">{t("Nothing announced.")}</p>}
      </Card>

      {c.analysts && (
        <Card title={t("Analysts")}>
          <dl>
            <Fact label={t("Consensus")} value={c.analysts.recommendation ? t(c.analysts.recommendation.replace(/_/g, " ")) : null} />
            <Fact label={t("Target (low – mean – high)")} value={c.analysts.targetMean === null ? null : [c.analysts.targetLow, c.analysts.targetMean, c.analysts.targetHigh].map((v) => (v === null ? "–" : quoted(v, r.currency))).join(" – ")} />
            <Fact label={t("Analysts")} value={c.analysts.count === null ? null : String(c.analysts.count)} />
          </dl>
          {votes && total > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="flex h-2.5 overflow-hidden rounded-full" role="img" aria-label={VOTES.map((v) => `${t(v.label)}: ${votes[v.key]}`).join(", ")}>
                {VOTES.map((v) => (
                  <span key={v.key} style={{ width: `${(votes[v.key] / total) * 100}%`, background: v.color }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                {VOTES.map((v) => (
                  <span key={v.key}>
                    {t(v.label)} {votes[v.key]}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {(c.holders.institutions !== null || c.holders.top.length > 0) && (
        <Card title={t("Shareholders")} className="lg:col-span-2 xl:col-span-4">
          <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
            <dl>
              <Fact label={t("Held by insiders")} value={share(c.holders.insiders)} />
              <Fact label={t("Held by institutions")} value={share(c.holders.institutions)} />
              <Fact label={t("Institutions")} value={c.holders.institutionCount === null ? null : number(c.holders.institutionCount)} />
              <Fact label={t("Short interest (of float)")} value={share(c.stats.shortOfFloat)} />
            </dl>
            {c.holders.top.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 font-medium">{t("Largest holders")}</th>
                    <th className="py-1 text-right font-medium">{t("Share")}</th>
                    <th className="py-1 text-right font-medium">{t("Value")}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.holders.top.map((h) => (
                    <tr key={h.name} className="border-t border-line">
                      <td className="py-1.5">{h.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{share(h.share) ?? "–"}</td>
                      <td className="py-1.5 text-right tabular-nums">{h.value === null ? "–" : big(h.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
