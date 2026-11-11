"use client";

import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Download } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { RANGES, type CompareData, type Range } from "@/lib/stocks/types";
import type { Period } from "@/lib/stocks/metrics";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { AppHeader } from "../../AppHeader";
import { Choice } from "../parts";
import { FigurePicker } from "./FigurePicker";
import { RatioView, ScatterView, TableView, parseOperand, writeOperand } from "./FigureViews";
import { MarketView, PerformanceView } from "./MarketViews";

const VIEWS = [
  { id: "table", label: msg("Table") },
  { id: "performance", label: msg("Performance") },
  { id: "scatter", label: msg("Scatter") },
  { id: "ratio", label: msg("Custom ratio") },
  { id: "market", label: msg("Portfolio × market") },
] as const;
type View = (typeof VIEWS)[number]["id"];

const RANGE_LABELS: Record<Range, string> = { "1m": msg("1M"), "6m": msg("6M"), ytd: msg("YTD"), "1y": msg("1Y"), "5y": msg("5Y"), max: msg("Max") };
const DEFAULT_MEASURES = ["marketCap", "pe", "netMargin", "revenueGrowth", "roe", "dividendYield"];
const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

/**
 * Symbols side by side on any figures: a table, their prices against a benchmark, a scatter on two
 * figures, a ratio of any two figures (of one company, two companies or the portfolio), and the
 * portfolio crossed with the market. Every choice is in the address, so a view can be kept or shared.
 */
export function ComparePage() {
  const t = useT();
  const router = useRouter();
  const q = useSearchParams();
  const symbols = list(q.get("s"));
  const measures = q.has("m") ? list(q.get("m")) : DEFAULT_MEASURES;
  const period: Period = q.get("p") === "quarterly" ? "quarterly" : "annual";
  const view = (VIEWS.find((v) => v.id === q.get("v"))?.id ?? "table") as View;
  const range = (RANGES as readonly string[]).includes(q.get("r") ?? "") ? (q.get("r") as Range) : "1y";
  const x = q.get("x") ?? measures[0] ?? "pe";
  const y = q.get("y") ?? measures[1] ?? measures[0] ?? "netMargin";

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(q.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`/stocks/compare?${next}`, { scroll: false });
  };

  const api = new URLSearchParams({ symbols: symbols.join(","), range, ...(q.get("bm") ? { benchmark: q.get("bm")! } : {}), ...(view === "market" || view === "ratio" ? { portfolio: "1" } : {}) });
  const { data, error, isLoading } = useSWR<CompareData>(symbols.length || view === "market" ? `/api/stocks/compare?${api}` : null, fetcher, { keepPreviousData: true });
  // Holdings, to add them in one click (cheap: the portfolio page's data is usually cached).
  const { data: held } = useSWR<{ positions: { symbol: string }[] }>("/api/stocks", fetcher);
  const exportHref = (format: string) => `/api/stocks/export?${new URLSearchParams({ what: "figures", format, symbols: symbols.join(","), measures: measures.join(","), period })}`;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <AppHeader title={t("Compare")} back={{ href: "/stocks", label: "Stocks" }} subtitle={t("Any figures of any symbols, side by side, and your portfolio against the market.")}>
        {symbols.length > 0 && measures.length > 0 && (
          <div className="flex items-center gap-1 text-sm">
            <Download className="h-4 w-4 text-muted" aria-hidden />
            {["csv", "xlsx"].map((f) => (
              <a key={f} href={exportHref(f)} className="rounded-full px-2.5 py-1 text-muted hover:bg-hover hover:text-fg" download>
                {t("Figures ({format})", { format: f.toUpperCase() })}
              </a>
            ))}
          </div>
        )}
      </AppHeader>

      <FigurePicker
        symbols={symbols}
        onSymbols={(s) => set({ s: s.join(",") })}
        measures={measures}
        onMeasures={(m) => set({ m: m.join(",") || "-" })}
        period={period}
        onPeriod={(p) => set({ p: p === "annual" ? null : p })}
        holdings={held?.positions.map((p) => p.symbol)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Choice label={t("View")} value={view} onChange={(v) => set({ v })} options={VIEWS.map((v) => ({ id: v.id, label: t(v.label) }))} />
        {(view === "performance" || view === "market") && <Choice label={t("Period")} value={range} onChange={(r) => set({ r })} options={RANGES.map((r) => ({ id: r, label: t(RANGE_LABELS[r]) }))} />}
      </div>

      {error && <p role="alert" className="text-sm text-[var(--err)]">{(error as Error).message}</p>}
      {!symbols.length && view !== "market" ? (
        <p className="glass rounded-3xl p-8 text-center text-muted">{t("Add symbols to compare, or your holdings in one click.")}</p>
      ) : !data ? (
        <p className="text-muted">{isLoading ? t("Loading…") : ""}</p>
      ) : view === "table" ? (
        <TableView data={data} measures={measures} />
      ) : view === "performance" ? (
        <PerformanceView data={data} onBenchmark={(bm) => set({ bm })} />
      ) : view === "scatter" ? (
        <ScatterView data={data} x={x} y={y} measures={measures} onAxes={(nx, ny) => set({ x: nx, y: ny })} />
      ) : view === "ratio" ? (
        <RatioView data={data} a={parseOperand(q.get("a"))} b={parseOperand(q.get("b"))} period={period} measures={measures} onChange={(a, b) => set({ a: writeOperand(a), b: writeOperand(b) })} />
      ) : (
        <MarketView data={data} />
      )}
    </main>
  );
}
