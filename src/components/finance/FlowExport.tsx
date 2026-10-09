"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Download, FileImage, FileSpreadsheet, FileText, PenTool } from "lucide-react";
import type { Flow } from "@/lib/finance/aggregate";
import { flowCsv } from "@/lib/finance/flowCsv";
import { downloadBlob, downloadPng, downloadSvg } from "@/lib/exportSvg";

/**
 * Export for the money-flow chart: the picture (PNG, SVG), the numbers (CSV), or a printable
 * one-page report to save as PDF. `chart` wraps the rendered Sankey.
 */
export function FlowExport({ chart, flow, currency, period }: { chart: RefObject<HTMLElement | null>; flow: Flow; currency: string; period: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const box = useRef<HTMLDivElement>(null);
  const base = `money-flow-${period}`;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const svg = () => chart.current?.querySelector<SVGSVGElement>("svg[role=img]") ?? null;
  const run = async (fn: () => void | Promise<void>) => {
    setOpen(false);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const items = [
    {
      label: "Image (PNG)",
      icon: FileImage,
      run: () => {
        const s = svg();
        if (!s) throw new Error("Nothing to export");
        return downloadPng(s, `${base}.png`);
      },
    },
    {
      label: "Vector (SVG)",
      icon: PenTool,
      run: () => {
        const s = svg();
        if (!s) throw new Error("Nothing to export");
        downloadSvg(s, `${base}.svg`);
      },
    },
    { label: "Flows (CSV)", icon: FileSpreadsheet, run: () => downloadBlob(new Blob([flowCsv(flow, currency)], { type: "text/csv;charset=utf-8" }), `${base}.csv`) },
    {
      label: "Report (PDF)",
      icon: FileText,
      run: () => void window.open(`/finance/report?period=${encodeURIComponent(period)}&currency=${encodeURIComponent(currency)}&print=1`, "_blank", "noopener"),
    },
  ];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted transition hover:bg-hover hover:text-fg"
      >
        <Download className="h-3.5 w-3.5" /> Export
      </button>
      {open && (
        <div role="menu" aria-label="Export the money flow" className="glass absolute top-full right-0 z-30 mt-1 flex w-44 flex-col rounded-xl p-1 text-sm" style={{ background: "var(--dialog)" }}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => void run(it.run)} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-hover">
              <it.icon className="h-4 w-4 text-muted" /> {it.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="absolute top-full right-0 mt-1 w-56 text-right text-xs text-[var(--err)]">
          {error}
        </p>
      )}
    </div>
  );
}
