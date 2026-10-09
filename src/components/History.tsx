"use client";

import { useId } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { Bucket } from "@/lib/history";
import { formatLocale } from "@/i18n/format";
import { useT } from "@/i18n/client";

interface HistoryResponse {
  range: string;
  uptime: number | null;
  buckets: Bucket[];
}

const barColor = (u: number | null) =>
  u === null ? "bg-track" : u >= 0.999 ? "bg-[var(--ok)]" : u >= 0.9 ? "bg-[var(--warn)]" : "bg-[var(--err)]";

const time = (ts: number) => new Date(ts).toLocaleTimeString(formatLocale(), { hour: "2-digit", minute: "2-digit" });

/** Uptime bars for the last 24h; `detailed` adds a latency line and the overall uptime. */
export function History({ id, detailed }: { id: string; detailed?: boolean }) {
  const t = useT();
  const { data } = useSWR<HistoryResponse>(`/api/history/${encodeURIComponent(id)}?range=24h`, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  const buckets = data?.buckets ?? [];
  if (!buckets.length) return <div className="h-5" />;

  return (
    <div className="mt-auto flex flex-col gap-1.5">
      {detailed && <LatencyLine buckets={buckets} />}
      <div className="flex h-5 items-end gap-[2px]" role="img" aria-label={t("Uptime last 24 hours: {value}", { value: fmt(data?.uptime) })}>
        {buckets.map((b) => (
          <span
            key={b.start}
            title={`${time(b.start)} · ${b.uptime === null ? t("no data") : t("{value} up", { value: fmt(b.uptime) })}${b.avgLatency ? ` · ${b.avgLatency} ms` : ""}`}
            className={`h-full flex-1 rounded-[2px] opacity-80 transition-opacity hover:opacity-100 ${barColor(b.uptime)}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted">
        <span>24h</span>
        <span className="tabular-nums">{fmt(data?.uptime)} {t("uptime")}</span>
        <span>{t("now")}</span>
      </div>
    </div>
  );
}

const fmt = (u: number | null | undefined) => (u == null ? "–" : `${(u * 100).toFixed(u >= 0.999 ? 2 : 1)}%`);

function LatencyLine({ buckets }: { buckets: Bucket[] }) {
  const t = useT();
  const gradientId = `lat${useId().replace(/[^\w-]/g, "")}`;
  const points = buckets.map((b, i) => ({ i, v: b.avgLatency })).filter((p): p is { i: number; v: number } => p.v !== null);
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.v)) * 1.15;
  const w = 100;
  const h = 32;
  const x = (i: number) => (i / (buckets.length - 1)) * w;
  const y = (v: number) => h - (v / max) * h;
  const line = points.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");
  const area = `${line} L${x(points.at(-1)!.i)},${h} L${x(points[0].i)},${h} Z`;
  const avg = Math.round(points.reduce((a, p) => a + p.v, 0) / points.length);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute top-0 right-0 text-[10px] text-muted tabular-nums">{t("avg")}{" "}{avg} {t("ms")}</span>
    </div>
  );
}
