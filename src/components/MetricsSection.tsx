"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { compact } from "./charts/common";
import { LineChart } from "./charts/LineChart";
import { formatLocale } from "@/i18n/format";
import { useT } from "@/i18n/client";

type Range = "24h" | "7d" | "30d";
const RANGES: Range[] = ["24h", "7d", "30d"];

interface MetricsData {
  x: number[];
  series: { key: string; values: (number | null)[]; last: number | null }[];
}

const formatTime = (range: Range) => (t: number) =>
  range === "24h"
    ? new Date(t).toLocaleTimeString(formatLocale(), { hour: "2-digit", minute: "2-digit" })
    : new Date(t).toLocaleDateString(formatLocale(), { month: "short", day: "numeric" });

/**
 * Recorded widget values (`record: true`): one small chart per value, since values have
 * different units and never share an axis.
 */
export function MetricsSection({ id }: { id: string }) {
  const t = useT();
  const [range, setRange] = useState<Range>("24h");
  const { data, isLoading } = useSWR<MetricsData>(`/api/metrics/${encodeURIComponent(id)}?range=${range}`, fetcher, {
    refreshInterval: 60_000,
    keepPreviousData: true,
  });
  const series = data?.series.filter((s) => s.values.some((v) => v !== null)) ?? [];

  return (
    <section className="glass flex flex-col gap-4 rounded-3xl p-5" aria-labelledby="metrics-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="metrics-title" className="text-sm font-semibold tracking-wider text-muted uppercase">
          {t("History")}
        </h2>
        <div className="flex rounded-full bg-chip p-1 text-sm" role="tablist" aria-label={t("Metrics time range")}>
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`rounded-full px-3 py-1 ${range === r ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {series.length ? (
        <div className="grid gap-5 md:grid-cols-2">
          {series.map((s) => (
            <div key={s.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{s.key}</h3>
                {s.last !== null && <span className="text-xs tabular-nums text-muted">{t("now")}{" "}{compact(s.last)}</span>}
              </div>
              <LineChart
                x={data!.x}
                series={[{ name: s.key, color: "var(--series-1)", values: s.values }]}
                height={150}
                area
                formatX={formatTime(range)}
                ariaLabel={t("{name} over the last {range}", { name: s.key, range })}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted">{isLoading ? t("Loading…") : t("Nothing recorded yet. Values are stored every minute.")}</p>
      )}
    </section>
  );
}
