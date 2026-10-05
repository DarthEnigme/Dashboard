"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { SeriesSet } from "@/integrations/types";
import { LineChart } from "./charts/LineChart";

type Range = "1h" | "24h" | "7d";

const formatTime = (range: Range) => (t: number) =>
  range === "7d"
    ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric" })
    : new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Charts for one widget row (Integration.series), e.g. a Proxmox guest's CPU, memory, network and disk. */
export function SeriesCharts({ id, target, label }: { id: string; target: string; label: string }) {
  const [range, setRange] = useState<Range>("1h");
  const { data, error, isLoading } = useSWR<SeriesSet>(
    `/api/widget/${encodeURIComponent(id)}/series?target=${encodeURIComponent(target)}&range=${range}`,
    fetcher,
    { refreshInterval: range === "1h" ? 60_000 : 0, keepPreviousData: true },
  );
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-chip p-3" role="region" aria-label={`Charts for ${label}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex rounded-full bg-track p-0.5 text-xs" role="tablist" aria-label={`Time range for ${label}`}>
          {(["1h", "24h", "7d"] as const).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`rounded-full px-2.5 py-0.5 ${range === r ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {error && !data && <p className="text-sm text-[var(--err)]">{(error as Error).message}</p>}
      {isLoading && !data && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading charts…
        </p>
      )}
      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          {data.charts.map((c) => (
            <div key={c.title}>
              <div className="mb-1 text-xs font-medium text-muted">
                {c.title}
                {c.unit && c.unit !== "%" ? ` (${c.unit})` : ""}
              </div>
              <LineChart
                x={c.x}
                series={c.series.map((s, i) => ({ name: s.name, color: `var(--series-${i + 1})`, values: s.values }))}
                height={130}
                unit={c.unit === "%" ? "%" : ""}
                area={c.series.length === 1}
                formatX={formatTime(range)}
                ariaLabel={`${label}: ${c.title} over the last ${range}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
