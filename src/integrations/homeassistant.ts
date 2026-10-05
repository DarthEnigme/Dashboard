import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";

const entity = z.union([z.string(), z.object({ entity: z.string(), label: z.string().optional() })]);

const schema = z.object({
  url: z.string().url(),
  /** Long-lived access token (profile → Security). */
  token: z.string().min(1),
  entities: z.array(entity).default([]),
  insecure: z.boolean().optional(),
});

export interface HaState {
  entity_id: string;
  state: string;
  attributes: { friendly_name?: string; unit_of_measurement?: string };
}

const UNAVAILABLE = new Set(["unavailable", "unknown"]);

function show(s: HaState | undefined, id: string, label?: string): WidgetField {
  if (!s) return { label: label ?? id, value: "not found", status: "warn" };
  const unit = s.attributes.unit_of_measurement;
  const num = Number(s.state);
  const value = Number.isFinite(num) && s.state.trim() !== "" ? `${Math.round(num * 10) / 10}${unit ? ` ${unit}` : ""}` : s.state;
  return {
    label: label ?? s.attributes.friendly_name ?? id,
    value,
    status: UNAVAILABLE.has(s.state) ? "warn" : undefined,
  };
}

/** Configured entities as fields; without any, a summary of lights, switches and unavailable entities. */
export function parseHomeAssistant(states: HaState[], entities: z.infer<typeof entity>[]): WidgetResult {
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  const rows = entities.map((e) => (typeof e === "string" ? show(byId.get(e), e) : show(byId.get(e.entity), e.entity, e.label)));
  if (rows.length) return { fields: rows.slice(0, 4), list: rows };

  const count = (pred: (s: HaState) => boolean) => states.filter(pred).length;
  const domain = (s: HaState) => s.entity_id.split(".")[0];
  const unavailable = count((s) => UNAVAILABLE.has(s.state));
  return {
    fields: [
      { label: "Lights on", value: count((s) => domain(s) === "light" && s.state === "on") },
      { label: "Switches on", value: count((s) => domain(s) === "switch" && s.state === "on") },
      { label: "Unavailable", value: unavailable, status: unavailable ? "warn" : "ok" },
      { label: "Entities", value: states.length },
    ],
  };
}

export const homeassistant: Integration<typeof schema> = {
  type: "homeassistant",
  schema,
  async fetch(cfg) {
    const states = await httpJson<HaState[]>(`${trimSlash(cfg.url)}/api/states`, {
      insecure: cfg.insecure,
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    return parseHomeAssistant(states, cfg.entities);
  },
};
