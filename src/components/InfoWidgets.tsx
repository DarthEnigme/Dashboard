"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Activity, Clock, Plane, Wallet } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { StatusRow } from "@/app/api/status/route";
import type { Trip } from "@/lib/travel/store";
import { nextTrip } from "@/lib/travel/nextTrip";
import { parseZones } from "@/info/zones";
import type { Summary } from "@/lib/finance/aggregate";
import { money } from "@/lib/finance/format";
import { formatLocale } from "@/i18n/format";
import { useT } from "@/i18n/client";

export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass flex min-h-16 items-center gap-4 rounded-2xl px-4 py-3 ${className}`}>{children}</div>;
}

/** The current time, ticking each second once in the browser (nothing on the server: no hydration mismatch). */
function useNow(): Date | undefined {
  const [now, setNow] = useState<Date>();
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function ClockWidget({ hour12, timezone, zones, seconds }: { hour12: boolean; timezone?: string; zones?: unknown; seconds: boolean }) {
  const now = useNow();
  const extra = parseZones(zones);
  if (!now) return <Chip className="w-48"><span /></Chip>;
  const time = (zone?: string, secs = false) =>
    now.toLocaleTimeString(formatLocale(), { timeZone: zone || undefined, hour: "2-digit", minute: "2-digit", ...(secs ? { second: "2-digit" } : {}), hour12 });
  return (
    <Chip className="flex-wrap gap-x-5">
      <Clock className="h-6 w-6 text-accent" />
      <div>
        <div className="text-2xl font-semibold tabular-nums">{time(timezone, seconds)}</div>
        <div className="text-xs text-muted">{now.toLocaleDateString(formatLocale(), { timeZone: timezone || undefined, weekday: "short", day: "numeric", month: "short" })}</div>
      </div>
      {extra.map((z) => (
        <div key={z.zone + z.label}>
          <div className="text-xs font-medium text-muted">{z.label}</div>
          <div className="font-semibold tabular-nums">{time(z.zone)}</div>
        </div>
      ))}
    </Chip>
  );
}

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The trip under way or the next one. Personal: shows nothing without the travel permission. */
export function TripWidget({ label }: { label?: string }) {
  const t = useT();
  const { data, error } = useSWR<{ trips: Trip[] }>("/api/travel", fetcher, { refreshInterval: 3_600_000, shouldRetryOnError: false });
  if (error || !data) return null;
  const next = nextTrip(data.trips, localDay());
  return (
    <Link href="/travel" className="glass glass-interactive flex min-h-16 items-center gap-4 rounded-2xl px-4 py-3">
      <Plane className="h-6 w-6 text-accent" />
      <div>
        <div className="text-sm text-muted">{label || t("Next trip")}</div>
        {!next ? (
          <div className="text-sm">{t("Nothing planned yet")}</div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="max-w-48 truncate font-semibold">{next.trip.title}</span>
            <span className="text-sm text-muted tabular-nums">
              {next.ongoing
                ? t("day {day} of {n}", { day: next.day, n: next.length })
                : next.inDays === 1
                  ? t("tomorrow")
                  : t.plural(next.inDays, "in {n} day", "in {n} days")}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

/** Up and down counts; opens the monitoring panel. Shares /api/status with the header button. */
export function StatusWidget({ refreshSeconds }: { refreshSeconds: number }) {
  const t = useT();
  const { data } = useSWR<StatusRow[]>("/api/status", fetcher, { refreshInterval: Math.max(10, refreshSeconds) * 1000 });
  if (!data?.length) return null;
  const down = data.filter((r) => r.up === false);
  const up = data.filter((r) => r.up === true).length;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("page:monitor"))}
      className="glass glass-interactive flex min-h-16 items-center gap-4 rounded-2xl px-4 py-3 text-left"
      title={down.length ? down.map((r) => r.name).join(", ") : undefined}
    >
      <Activity className={`h-6 w-6 ${down.length ? "text-[var(--err)]" : "text-[var(--ok)]"}`} />
      <div>
        <div className="text-sm text-muted">{t("Services")}</div>
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-2xl font-semibold">{up}</span>
          <span className="text-sm text-muted">{t("up")}</span>
          {down.length > 0 && (
            <span className="text-sm font-medium text-[var(--err)]">
              · {down.length} {t("down")}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export const FINANCE_PARTS = ["spent", "income", "net", "balance", "budgets"] as const;

/** This month's money at a glance. Personal: shows nothing without the finance permission. */
export function FinanceWidget({ show, currency }: { show?: unknown; currency?: string }) {
  const t = useT();
  const parts = new Set((Array.isArray(show) && show.length ? show : ["spent", "income", "budgets"]).map(String));
  const q = new URLSearchParams({ period: localDay().slice(0, 7) });
  if (currency) q.set("currency", currency);
  const { data, error } = useSWR<Summary>(`/api/finance/summary?${q}`, fetcher, { refreshInterval: 300_000, shouldRetryOnError: false });
  if (error || !data) return null;
  const c = data.currency;
  const stats: { label: string; value: string; tone?: string }[] = [];
  if (parts.has("spent")) stats.push({ label: t("Spent"), value: money(data.expense, c) });
  if (parts.has("income")) stats.push({ label: t("Income"), value: money(data.income, c) });
  if (parts.has("net")) stats.push({ label: t("Net"), value: money(data.net, c, true), tone: data.net < 0 ? "text-[var(--err)]" : "text-[var(--ok)]" });
  const balance = data.balance.at(-1);
  if (parts.has("balance") && balance) stats.push({ label: t("Balance"), value: money(balance.cents, c) });
  // The three budgets closest to (or past) their limit.
  const budgets = parts.has("budgets")
    ? data.budgets
        .filter((b) => b.budget > 0)
        .map((b) => ({ ...b, ratio: b.spent / b.budget }))
        .sort((a, b) => b.ratio - a.ratio)
        .slice(0, 3)
    : [];
  if (!stats.length && !budgets.length) return null;
  return (
    <Link href="/finance" className="glass glass-interactive flex min-h-16 flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl px-4 py-3">
      <Wallet className="h-6 w-6 text-accent" />
      {stats.map((s) => (
        <div key={s.label}>
          <div className="text-xs font-medium text-muted uppercase">{s.label}</div>
          <div className={`font-semibold tabular-nums ${s.tone ?? ""}`}>{s.value}</div>
        </div>
      ))}
      {budgets.map((b) => (
        <div key={b.name} className="w-28" title={`${money(b.spent, c)} / ${money(b.budget, c)}`}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted">{b.name}</span>
            <span className="font-semibold tabular-nums">{Math.round(b.ratio * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-track">
            <div
              className={`h-full rounded-full ${b.ratio >= 1 ? "bg-[var(--err)]" : b.ratio >= 0.8 ? "bg-[var(--warn)]" : "bg-accent"}`}
              style={{ width: `${Math.min(b.ratio, 1) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </Link>
  );
}
