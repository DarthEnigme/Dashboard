"use client";

import type { RefObject } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import type { Flow } from "@/lib/finance/aggregate";
import { flowCsv } from "@/lib/finance/flowCsv";
import { downloadBlob } from "@/lib/exportSvg";
import { useT } from "@/i18n/client";
import { ChartExport } from "../charts/ChartExport";

/**
 * Export for the money-flow chart: the picture (PNG, SVG), the numbers (CSV), or a printable
 * one-page report to save as PDF. `chart` wraps the rendered Sankey.
 */
export function FlowExport({ chart, flow, currency, period }: { chart: RefObject<HTMLElement | null>; flow: Flow; currency: string; period: string }) {
  const t = useT();
  const base = `money-flow-${period}`;
  return (
    <ChartExport
      chart={chart}
      name={base}
      label={t("Export the money flow")}
      extra={[
        { label: t("Flows (CSV)"), icon: FileSpreadsheet, run: () => downloadBlob(new Blob([flowCsv(flow, currency)], { type: "text/csv;charset=utf-8" }), `${base}.csv`) },
        { label: t("Report (PDF)"), icon: FileText, run: () => void window.open(`/finance/report?period=${encodeURIComponent(period)}&currency=${encodeURIComponent(currency)}&print=1`, "_blank", "noopener") },
      ]}
    />
  );
}
