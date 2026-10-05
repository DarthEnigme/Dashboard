"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { PingResult } from "@/lib/checks";

const SLOW_MS = 1000;

export function StatusDot({ id, interval }: { id: string; interval: number }) {
  const { data, error } = useSWR<PingResult & { certWarn?: boolean }>(`/api/ping?id=${encodeURIComponent(id)}`, fetcher, {
    refreshInterval: interval * 1000,
    revalidateOnFocus: false,
  });

  let color = "bg-muted/50";
  let label = "Checking…";
  if (error || (data && !data.up)) {
    color = "bg-[var(--err)]";
    label = data?.error ? `Down (${data.error})` : data?.status ? `Down (HTTP ${data.status})` : "Down";
  } else if (data) {
    const slow = (data.latencyMs ?? 0) > SLOW_MS;
    color = slow ? "bg-[var(--warn)]" : "bg-[var(--ok)]";
    label = `Up · ${data.latencyMs} ms${data.status ? ` · HTTP ${data.status}` : ""}`;
  }
  const cert = data?.cert;
  const certLabel = data?.certWarn && cert ? (cert.daysLeft < 0 ? "TLS certificate expired" : `TLS certificate expires in ${cert.daysLeft} d`) : undefined;
  if (certLabel) label = `${label} · ${certLabel}`;

  return (
    <span className="flex shrink-0 items-center gap-1.5 self-start pt-1" title={label}>
      {certLabel && (
        <span className="rounded-full bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] px-1.5 text-[10px] font-medium text-[var(--warn)]" aria-hidden>
          {cert!.daysLeft < 0 ? "cert expired" : `cert ${cert!.daysLeft}d`}
        </span>
      )}
      {data?.up && <span className="text-[11px] tabular-nums text-muted">{data.latencyMs}ms</span>}
      <span className="relative flex h-2.5 w-2.5">
        {data?.up && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 motion-reduce:hidden ${color}`} />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color} ${!data && !error ? "animate-pulse" : ""}`} />
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
