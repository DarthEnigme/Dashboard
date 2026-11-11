"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Download, FileImage, PenTool, type LucideIcon } from "lucide-react";
import { downloadPng, downloadSvg } from "@/lib/exportSvg";
import { useT } from "@/i18n/client";

export interface ExportItem {
  label: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
}

/**
 * An "Export" menu for a chart: the picture as PNG or SVG, plus whatever `extra` the chart offers
 * (its numbers, a report). `chart` wraps the rendered chart; `name` is the file name, without extension.
 */
export function ChartExport({ chart, name, extra = [], label }: { chart: RefObject<HTMLElement | null>; name: string; extra?: ExportItem[]; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const box = useRef<HTMLDivElement>(null);

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

  const svg = () => {
    const s = chart.current?.querySelector<SVGSVGElement>("svg[role=img]");
    if (!s) throw new Error(t("Nothing to export"));
    return s;
  };
  const run = async (fn: () => void | Promise<void>) => {
    setOpen(false);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const items: ExportItem[] = [{ label: t("Image (PNG)"), icon: FileImage, run: () => downloadPng(svg(), `${name}.png`) }, { label: t("Vector (SVG)"), icon: PenTool, run: () => downloadSvg(svg(), `${name}.svg`) }, ...extra];

  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted transition hover:bg-hover hover:text-fg">
        <Download className="h-3.5 w-3.5" /> {t("Export")}
      </button>
      {open && (
        <div role="menu" aria-label={label ?? t("Export")} className="glass absolute top-full right-0 z-30 mt-1 flex w-44 flex-col rounded-xl p-1 text-sm" style={{ background: "var(--dialog)" }}>
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
