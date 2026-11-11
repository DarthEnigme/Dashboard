"use client";

import Link from "next/link";
import useSWR from "swr";
import { CandlestickChart } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { StocksSummary } from "@/lib/stocks/types";
import { useT } from "@/i18n/client";
import { cash, percent, tone } from "./format";
import { SymbolIcon } from "./SymbolIcon";

/** All of one's portfolios: value, today's change, and the best and worst mover. Personal: shows nothing without the stocks permission. */
export function StocksWidget({ label }: { label?: string }) {
  const t = useT();
  const { data, error } = useSWR<StocksSummary>("/api/stocks/summary", fetcher, { refreshInterval: 900_000, shouldRetryOnError: false });
  if (error || !data || !data.holdings) return null;
  const mover = (m: StocksSummary["best"]) =>
    m && (
      <span className="flex items-center gap-1 text-xs">
        <SymbolIcon symbol={m.symbol} size={16} />
        {m.symbol} <span className={`tabular-nums ${tone(m.change)}`}>{percent(m.change)}</span>
      </span>
    );
  return (
    <Link href="/stocks" className="glass glass-interactive flex min-h-16 items-center gap-4 rounded-2xl px-4 py-3">
      <CandlestickChart className="h-6 w-6 text-accent" />
      <div>
        <div className="text-sm text-muted">{label || t("Portfolio")}</div>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{cash(data.value, data.currency)}</span>
          <span className={`text-sm tabular-nums ${tone(data.dayChange)}`}>{percent(data.dayChangePct)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {mover(data.best)}
        {mover(data.worst)}
      </div>
    </Link>
  );
}
