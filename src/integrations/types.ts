import type { z } from "zod";
import type { Flow } from "@/lib/finance/aggregate";

export type FieldStatus = "ok" | "warn" | "error";

export interface WidgetField {
  label: string;
  value: string | number;
  status?: FieldStatus;
  /** List rows only: open this link (e.g. an RSS article). */
  href?: string;
  /** The number behind `value` when it is formatted (bytes, rates…), for history and thresholds. */
  raw?: number;
  /** Something with its own charts (Integration.series), e.g. a Proxmox guest; rows open them on the service page. */
  target?: string;
  /**
   * A one-tap action on this field (a Home Assistant light): runs `action` on `target` through
   * the service's actions, for people allowed to. `on` makes it a switch; without it, a button.
   */
  control?: { action: string; target: string; on?: boolean; label?: string };
}

/**
 * `fields` show on every tile; `list` rows (per-monitor detail…) only on large tiles,
 * unless `compactList` is set: then the list is the main content (calendar, RSS) and small
 * tiles show that many rows, wide tiles twice as many, tall and large tiles all of them.
 */
export interface WidgetResult {
  fields: WidgetField[];
  list?: WidgetField[];
  compactList?: number;
  /** Chart data (finance tile); which charts show depends on the tile size. */
  charts?: WidgetCharts;
  /** Small trend lines (metrics), oldest value first; shown on all but small tiles. */
  sparks?: WidgetSpark[];
  /** Pages embedded on the service detail page (e.g. Grafana panels). */
  embeds?: { title: string; url: string }[];
  /** Extra titled lists for the service page (nodes, storage, backups…). */
  sections?: { title: string; rows: WidgetField[] }[];
}

/** Time series for one target, as small multiples (each chart has one unit). */
export interface SeriesSet {
  charts: { title: string; unit?: string; x: number[]; series: { name: string; values: (number | null)[] }[] }[];
}

export interface WidgetSpark {
  label: string;
  values: number[];
  /** Pre-formatted latest value, shown next to the label. */
  current: string;
  /** Unit appended to hover values (e.g. "%"). */
  unit?: string;
  /** Fixed top of the y-scale (100 for percentages); otherwise the max of the data. */
  max?: number;
}

export interface WidgetCharts {
  currency: string;
  /** Spending by category; slot = palette slot 1–8, null = "Other". */
  donut?: { name: string; cents: number; slot: number | null; color?: string | null }[];
  /** Income and spending per month. */
  bars?: { month: string; income: number; expense: number }[];
  /** Running balance at month end. */
  balance?: { month: string; cents: number }[];
  /** Income → spending flow for the period (Sankey). */
  flow?: Flow;
  /** Main chart: the category donut (default) or the money-flow Sankey. */
  main?: "donut" | "sankey";
}

/** Something an admin can do to the service, e.g. restart a container or start a VM. */
export interface ServiceAction {
  id: string;
  label: string;
  /** Sub-resource the action applies to (e.g. a Proxmox guest); omitted for the service itself. */
  target?: string;
  targetLabel?: string;
  /** Disruptive (stop, hard reset): shown in red and confirmed more firmly. */
  danger?: boolean;
}

export interface Integration<C extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string;
  schema: C;
  fetch(config: z.infer<C>, ctx: { serviceName: string }): Promise<WidgetResult | WidgetField[]>;
  /** Charts for a list row's `target` over a range ("1h", "24h", "7d"). */
  series?(config: z.infer<C>, target: string, range: "1h" | "24h" | "7d"): Promise<SeriesSet>;
  actions?: {
    /** Actions that make sense right now (depends on current state). */
    list(config: z.infer<C>): Promise<ServiceAction[]>;
    /** Perform it; resolves to a short human-readable result. */
    run(config: z.infer<C>, action: string, target?: string): Promise<string>;
  };
}

export const toResult = (r: WidgetResult | WidgetField[]): WidgetResult => (Array.isArray(r) ? { fields: r } : r);
