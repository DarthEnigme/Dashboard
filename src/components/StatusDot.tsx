"use client";

import useSWR from "swr";
import { BellOff, Wrench } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { PingResult } from "@/lib/checks";
import { useT } from "@/i18n/client";

const SLOW_MS = 1000;
/** Shared by every tile's status light and uptime bars. */
export const TILES = "/api/tiles";

type Ping = PingResult & { certWarn?: boolean; muted?: boolean; maintenance?: boolean };

/**
 * A service's status light. On the dashboard (`shared`) every tile reads the same /api/tiles answer,
 * one request for all of them; alone on a service page it asks /api/ping for itself.
 */
export function StatusDot({ id, interval, shared }: { id: string; interval: number; shared?: boolean }) {
  const t = useT();
  const { data: answer, error } = useSWR<Ping | Record<string, { ping: Ping }>>(shared ? TILES : `/api/ping?id=${encodeURIComponent(id)}`, fetcher, {
    refreshInterval: interval * 1000,
    revalidateOnFocus: false,
  });
  const data = shared ? (answer as Record<string, { ping: Ping }> | undefined)?.[id]?.ping : (answer as Ping | undefined);

  let color = "bg-muted/50";
  let label = t("Checking…");
  if (error || (data && !data.up)) {
    color = "bg-[var(--err)]";
    label = data?.error ? t("Down ({reason})", { reason: data.error }) : data?.status ? t("Down ({reason})", { reason: `HTTP ${data.status}` }) : t("Down");
  } else if (data) {
    const slow = (data.latencyMs ?? 0) > SLOW_MS;
    color = slow ? "bg-[var(--warn)]" : "bg-[var(--ok)]";
    label = `${t("Up")} · ${data.latencyMs} ms${data.status ? ` · HTTP ${data.status}` : ""}`;
  }
  const cert = data?.cert;
  const certLabel = data?.certWarn && cert ? (cert.daysLeft < 0 ? t("TLS certificate expired") : t("TLS certificate expires in {n} d", { n: cert.daysLeft })) : undefined;
  if (certLabel) label = `${label} · ${certLabel}`;
  if (data?.maintenance) label = `${label} · ${t("in maintenance")}`;
  if (data?.muted) label = `${label} · ${t("alerts muted")}`;

  return (
    <span className="flex shrink-0 items-center gap-1.5 self-start pt-1" title={label}>
      {certLabel && (
        <span className="rounded-full bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] px-1.5 text-[10px] font-medium text-[var(--warn)]" aria-hidden>
          {cert!.daysLeft < 0 ? t("cert expired") : t("cert {n}d", { n: cert!.daysLeft })}
        </span>
      )}
      {data?.maintenance && <Wrench className="h-3 w-3 text-accent" aria-hidden />}
      {data?.muted && <BellOff className="h-3 w-3 text-[var(--warn)]" aria-hidden />}
      {data?.up && <span className="text-[11px] tabular-nums text-muted">{data.latencyMs}{t("ms")}</span>}
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
