"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { FieldStatus, WidgetResult } from "@/integrations/types";
import type { TileSize } from "@/lib/config/schema";
import { FinanceCharts } from "./charts/FinanceCharts";
import { Sparkline } from "./charts/Sparkline";
import { SeriesCharts } from "./SeriesCharts";

const statusColor: Record<FieldStatus, string> = {
  ok: "text-fg",
  warn: "text-[var(--warn)]",
  error: "text-[var(--err)]",
};

interface Props {
  id: string;
  interval: number;
  /** Tile size decides how much shows; "detail" (the service page) shows everything. */
  size: TileSize | "detail";
}

function listRows(data: WidgetResult | undefined, size: Props["size"]): number {
  const n = data?.list?.length ?? 0;
  if (size === "detail" || size === "large" || size === "tall") return data?.compactList || size !== "tall" ? n : 0;
  if (!data?.compactList) return 0;
  return size === "wide" ? data.compactList * 2 : data.compactList;
}

export function WidgetFields({ id, interval, size }: Props) {
  const { data, error, isLoading } = useSWR<WidgetResult>(`/api/widget/${encodeURIComponent(id)}`, fetcher, {
    refreshInterval: interval * 1000,
    keepPreviousData: true,
  });
  const [openTarget, setOpenTarget] = useState<string>();

  if (error && !data) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-[var(--err)]/10 px-2.5 py-1.5 text-xs text-[var(--err)]" title={error.message}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{error.message}</span>
      </div>
    );
  }

  const fields = (data?.fields ?? []).slice(0, size === "small" ? 4 : undefined);
  const list = (data?.list ?? []).slice(0, listRows(data, size));
  return (
    <>
      {(fields.length > 0 || (isLoading && !data)) && (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(4.25rem,1fr))] gap-1.5">
        {isLoading && !data
          ? Array.from({ length: 3 }, (_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-track" />)
          : fields.map((f) => (
              <div key={f.label} title={`${f.label}: ${f.value}`} className="min-w-0 rounded-lg bg-chip px-1.5 py-1.5 text-center ring-1 ring-chip-ring ring-inset">
                {/* Long values (currencies) step down a size instead of truncating on small tiles. */}
                <div data-status={f.status} className={`truncate font-semibold tabular-nums ${String(f.value).length > 8 ? "text-xs leading-5" : "text-sm"} ${statusColor[f.status ?? "ok"]}`}>
                  {f.value}
                </div>
                <div className="truncate text-[10px] font-medium tracking-wide text-muted uppercase">{f.label}</div>
              </div>
            ))}
      </div>
      )}
      {list.length > 0 && (
        <ul className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto text-sm">
          {list.map((row, i) => {
            // On the service page, rows with their own charts expand to show them.
            const expandable = size === "detail" && !!row.target;
            const open = expandable && openTarget === row.target;
            return (
              <li key={`${row.label}-${i}`} className="flex flex-col rounded-lg odd:bg-row">
                <div className="flex items-center justify-between gap-3 px-1 py-1">
                  {/* Sits above the card's stretched title link, so it is clickable on its own. */}
                  {row.href ? (
                    <a href={row.href} target="_blank" rel="noreferrer" className="relative z-10 truncate text-fg/90 hover:text-accent hover:underline">
                      {row.label}
                    </a>
                  ) : expandable ? (
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenTarget(open ? undefined : row.target)}
                      className="flex min-w-0 items-center gap-1 truncate text-left text-fg/90 hover:text-accent"
                    >
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                      {row.label}
                    </button>
                  ) : (
                    <span className="truncate text-muted">{row.label}</span>
                  )}
                  <span data-status={row.status} className={`shrink-0 tabular-nums ${row.href ? "text-xs text-muted" : "font-medium"} ${row.href ? "" : statusColor[row.status ?? "ok"]}`}>{row.value}</span>
                </div>
                {open && <SeriesCharts id={id} target={row.target!} label={row.label} />}
              </li>
            );
          })}
        </ul>
      )}
      {size === "detail" &&
        data?.sections?.map((sec) => (
          <section key={sec.title} aria-label={sec.title} className="flex flex-col gap-1">
            <h3 className="px-1 pt-2 text-xs font-semibold tracking-wider text-muted uppercase">{sec.title}</h3>
            <ul className="-mx-1 flex flex-col text-sm">
              {sec.rows.map((row, i) => (
                <li key={`${row.label}-${i}`} className="flex items-center justify-between gap-3 rounded-lg px-1 py-1 odd:bg-row">
                  <span className="truncate text-muted">{row.label}</span>
                  <span data-status={row.status} className={`shrink-0 text-right tabular-nums font-medium ${statusColor[row.status ?? "ok"]}`}>
                    {row.value}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {size !== "small" && data?.sparks && data.sparks.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-2">
          {data.sparks.slice(0, size === "wide" ? 2 : undefined).map((s) => (
            <Sparkline key={s.label} spark={s} />
          ))}
        </div>
      )}
      {data?.charts && <FinanceCharts charts={data.charts} size={size} />}
      {size === "detail" && data?.embeds && data.embeds.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.embeds.map((e) => (
            <figure key={e.url} className="flex flex-col gap-1.5">
              <figcaption className="text-xs font-medium text-muted">{e.title}</figcaption>
              <iframe src={e.url} title={e.title} loading="lazy" className="h-64 w-full rounded-xl border-0 bg-chip" referrerPolicy="no-referrer" />
            </figure>
          ))}
        </div>
      )}
    </>
  );
}
