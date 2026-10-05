"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, CheckCircle2, CircleAlert, ExternalLink } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { ClientService, ClientSettings } from "@/lib/config/sanitize";
import type { Bucket, Range } from "@/lib/history";
import type { IncidentRow } from "@/lib/db";
import { duration } from "@/integrations/format";
import { Icon } from "./Icon";
import { StatusDot } from "./StatusDot";
import { WidgetFields } from "./WidgetFields";
import { MetricsSection } from "./MetricsSection";
import { ActionMenu } from "./ActionMenu";
import { LineChart } from "./charts/LineChart";
import { Legend, Tooltip, useWidth } from "./charts/common";

interface HistoryData {
  range: Range;
  uptime: number | null;
  avgLatency: number | null;
  p95Latency: number | null;
  buckets: Bucket[];
  incidents: IncidentRow[];
}

const RANGES: Range[] = ["24h", "7d", "30d", "90d"];
const pctText = (u: number | null) => (u === null ? "–" : `${(u * 100).toFixed(u >= 0.9995 ? 2 : u >= 0.99 ? 2 : 1)}%`);

function formatTime(range: Range) {
  return (t: number) =>
    range === "24h"
      ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date(t).toLocaleDateString([], { month: "short", day: "numeric", ...(range === "7d" ? { hour: "2-digit" } : {}) });
}

interface Props {
  service: ClientService;
  group: string;
  settings: ClientSettings;
  canAct: boolean;
}

export function ServiceDetail({ service: s, group, settings, canAct }: Props) {
  const [range, setRange] = useState<Range>("24h");
  const { data, isLoading } = useSWR<HistoryData>(
    s.ping ? `/api/history/${encodeURIComponent(s.id)}?range=${range}&incidents=1` : null,
    fetcher,
    { refreshInterval: 60_000, keepPreviousData: true },
  );
  const fmt = formatTime(range);
  const ongoing = data?.incidents.find((i) => i.end === null);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <header className="glass flex flex-wrap items-center gap-4 rounded-3xl p-5">
        <Icon icon={s.icon} name={s.name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold tracking-wider text-muted uppercase">{group}</div>
          <h1 className="truncate text-2xl font-bold tracking-tight">{s.name}</h1>
          {s.description && <p className="text-sm text-muted">{s.description}</p>}
        </div>
        {s.ping && <StatusDot id={s.id} interval={settings.pingInterval} />}
        {canAct && s.actions && <ActionMenu service={s} />}
        {s.href && (
          <a
            href={s.href}
            target={settings.target}
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/30 hover:brightness-110"
          >
            Open <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </header>

      {s.widget && (
        <section className="glass flex flex-col gap-3 rounded-3xl p-5">
          <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Live data</h2>
          <WidgetFields id={s.id} interval={settings.refreshInterval} size="detail" />
        </section>
      )}

      {s.metrics && <MetricsSection id={s.id} />}

      {s.ping ? (
        <section className="glass flex flex-col gap-5 rounded-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Availability</h2>
            <div className="flex rounded-full bg-chip p-1 text-sm" role="tablist" aria-label="Time range">
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Uptime" value={pctText(data?.uptime ?? null)} />
            <Stat label="Avg response" value={data?.avgLatency == null ? "–" : `${data.avgLatency} ms`} />
            <Stat label="95th percentile" value={data?.p95Latency == null ? "–" : `${data.p95Latency} ms`} />
            <Stat
              label="Incidents"
              value={data ? String(data.incidents.length) : "–"}
              note={ongoing ? "1 ongoing" : undefined}
            />
          </div>

          {data && <AvailabilityBars buckets={data.buckets} format={fmt} />}

          <div>
            <h3 className="mb-2 text-sm font-medium">Response time</h3>
            {data && data.buckets.some((b) => b.avgLatency !== null) ? (
              <LineChart
                x={data.buckets.map((b) => b.start)}
                series={[
                  { name: "Average", color: "var(--series-1)", values: data.buckets.map((b) => b.avgLatency) },
                  { name: "95th percentile", color: "var(--series-2)", values: data.buckets.map((b) => b.p95Latency) },
                ]}
                unit=" ms"
                formatX={fmt}
                ariaLabel={`Response time over the last ${range}`}
              />
            ) : (
              <p className="py-10 text-center text-sm text-muted">{isLoading ? "Loading…" : "No measurements in this range yet."}</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Incidents</h3>
            {data?.incidents.length ? (
              <ol className="flex flex-col gap-1.5">
                {data.incidents.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl bg-chip px-3 py-2 text-sm">
                    {i.end === null ? (
                      <CircleAlert className="h-4 w-4 shrink-0 text-[var(--err)]" aria-label="Ongoing" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ok)]" aria-label="Resolved" />
                    )}
                    <span className="font-medium">{i.end === null ? "Down now" : "Outage"}</span>
                    <span className="text-muted">{new Date(i.start).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                    <span className="text-muted">
                      {i.end === null ? `for ${duration((Date.now() - i.start) / 1000)}` : `lasted ${duration((i.end - i.start) / 1000)}`}
                    </span>
                    {i.cause && <span className="ml-auto text-xs text-muted">{i.cause}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">No outages in this range.</p>
            )}
          </div>
        </section>
      ) : (
        <p className="glass rounded-3xl p-5 text-sm text-muted">Turn on a status check for this service to see its availability history.</p>
      )}
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-chip p-3 ring-1 ring-chip-ring ring-inset">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {note && <div className="text-xs text-[var(--err)]">{note}</div>}
    </div>
  );
}

const status = (u: number | null) =>
  u === null
    ? { color: "var(--track)", label: "No data" }
    : u >= 0.999
      ? { color: "var(--ok)", label: "Up" }
      : u >= 0.9
        ? { color: "var(--warn)", label: "Degraded" }
        : { color: "var(--err)", label: "Down" };

/** One bar per bucket, colored by status; the legend names each state so color is never alone. */
function AvailabilityBars({ buckets, format }: { buckets: Bucket[]; format: (t: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const gap = 2;
  const barW = width ? (width - gap * (buckets.length - 1)) / buckets.length : 0;
  return (
    <div className="flex flex-col gap-2">
      <Legend
        items={[
          { label: "Up", color: "var(--ok)" },
          { label: "Degraded (90–99.9%)", color: "var(--warn)" },
          { label: "Down (<90%)", color: "var(--err)" },
          { label: "No data", color: "var(--track)" },
        ]}
      />
      <div ref={ref} className="relative h-10" onPointerLeave={() => setHover(undefined)}>
        {width > 0 && (
          <svg width={width} height={40} role="img" aria-label="Availability per time slot">
            {buckets.map((b, i) => (
              <rect
                key={b.start}
                x={i * (barW + gap)}
                y={0}
                width={Math.max(barW, 1)}
                height={40}
                rx={Math.min(3, barW / 2)}
                fill={status(b.uptime).color}
                opacity={hover === undefined || hover === i ? 1 : 0.55}
                onPointerEnter={() => setHover(i)}
              />
            ))}
          </svg>
        )}
        {hover !== undefined && (
          <Tooltip x={hover * (barW + gap)} y={44} width={width}>
            <div className="text-muted">{format(buckets[hover].start)}</div>
            <div className="font-medium">
              {status(buckets[hover].uptime).label}
              {buckets[hover].uptime !== null && ` · ${pctText(buckets[hover].uptime)}`}
            </div>
            <div className="text-muted">{buckets[hover].checks} checks</div>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
