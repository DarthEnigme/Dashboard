import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";

/**
 * Home Assistant energy: today's consumption, solar production and grid import/export, from the
 * energy meters (sensors that count up, in kWh) you name, read from HA's history since midnight.
 */
const schema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  insecure: z.boolean().optional(),
  entities: z
    .object({
      consumption: z.string().optional(),
      solar: z.string().optional(),
      gridImport: z.string().optional(),
      gridExport: z.string().optional(),
      /** Sensors in W, shown as they are now on large tiles. */
      power: z.array(z.string()).default([]),
    })
    .prefault({}),
  /** Price of a kWh bought from the grid, for today's cost. */
  price: z.number().nonnegative().optional(),
  currency: z.string().default("€"),
});
type Cfg = z.infer<typeof schema>;
type Meter = "consumption" | "solar" | "gridImport" | "gridExport";
const METERS: Meter[] = ["consumption", "solar", "gridImport", "gridExport"];

/** One reading in HA's minimal history answer. */
export interface HaPoint {
  entity_id?: string;
  state: string;
}

/**
 * What a meter counted over its readings: the sum of its rises. A drop is a reset (daily meters,
 * a replaced device): counting goes on from the new value.
 */
export function counted(points: HaPoint[]): number | null {
  const values = points.map((p) => Number(p.state)).filter((v) => Number.isFinite(v));
  if (!values.length) return null;
  let total = 0;
  for (let i = 1; i < values.length; i++) total += values[i] >= values[i - 1] ? values[i] - values[i - 1] : values[i];
  return total;
}

const kwh = (v: number) => `${v.toFixed(v < 10 ? 2 : 1)} kWh`;

/** HA's history answer (one list per entity) → today's numbers per meter. */
export function energyToday(history: HaPoint[][], entities: Partial<Record<Meter, string>>): Partial<Record<Meter, number>> {
  const byEntity = new Map(history.map((list) => [list[0]?.entity_id, list]));
  const out: Partial<Record<Meter, number>> = {};
  for (const m of METERS) {
    const id = entities[m];
    const v = id ? counted(byEntity.get(id) ?? []) : null;
    if (v !== null) out[m] = v;
  }
  return out;
}

export function parseEnergy(today: Partial<Record<Meter, number>>, cfg: Pick<Cfg, "price" | "currency">, power: { name: string; watts: number }[] = []): WidgetResult {
  const { solar, gridImport, gridExport } = today;
  // Without a consumption meter: what came from the grid plus what the panels made and the house kept.
  const consumption = today.consumption ?? (gridImport !== undefined && solar !== undefined ? gridImport + solar - (gridExport ?? 0) : gridImport);
  const fields: WidgetField[] = [];
  const add = (label: string, v: number | undefined) => v !== undefined && fields.push({ label, value: kwh(v), raw: Math.round(v * 1000) / 1000 });
  add("Consumption", consumption);
  add("Solar", solar);
  add("Grid in", gridImport);
  add("Grid out", gridExport);
  if (solar && solar > 0) {
    const self = Math.max(0, Math.min(1, (solar - (gridExport ?? 0)) / solar));
    fields.push({ label: "Self-use", value: `${Math.round(self * 100)}%`, raw: Math.round(self * 100) });
  }
  if (cfg.price !== undefined && gridImport !== undefined) {
    const cost = gridImport * cfg.price;
    fields.push({ label: "Cost", value: `${cost.toFixed(2)} ${cfg.currency}`, raw: Math.round(cost * 100) / 100 });
  }
  return {
    fields,
    list: power.map((p) => ({ label: p.name, value: Math.abs(p.watts) >= 1000 ? `${(p.watts / 1000).toFixed(2)} kW` : `${Math.round(p.watts)} W`, raw: p.watts })),
  };
}

export const homeassistantEnergy: Integration<typeof schema> = {
  type: "homeassistant-energy",
  schema,
  async fetch(cfg) {
    const b = trimSlash(cfg.url);
    const opts = { insecure: cfg.insecure, headers: { Authorization: `Bearer ${cfg.token}` }, timeoutMs: 15_000 };
    const ids = METERS.map((m) => cfg.entities[m]).filter((x): x is string => !!x);
    if (!ids.length && !cfg.entities.power.length) throw new Error("Name at least one energy sensor under entities (consumption, solar, gridImport, gridExport)");
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const q = new URLSearchParams({ filter_entity_id: ids.join(","), end_time: new Date().toISOString() });
    // minimal_response and no_attributes are flags without a value.
    const history = ids.length ? await httpJson<HaPoint[][]>(`${b}/api/history/period/${encodeURIComponent(midnight.toISOString())}?${q}&minimal_response&no_attributes`, opts) : [];
    const power = await Promise.all(
      cfg.entities.power.map(async (id) => {
        const s = await httpJson<{ state: string; attributes?: { friendly_name?: string } }>(`${b}/api/states/${encodeURIComponent(id)}`, opts).catch(() => undefined);
        const watts = Number(s?.state);
        return Number.isFinite(watts) ? { name: s?.attributes?.friendly_name ?? id, watts } : null;
      }),
    );
    return parseEnergy(energyToday(history, cfg.entities), cfg, power.filter((p) => p !== null));
  },
};
