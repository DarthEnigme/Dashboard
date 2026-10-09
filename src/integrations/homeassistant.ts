import { z } from "zod";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration, ServiceAction, WidgetField, WidgetResult } from "./types";

const entity = z.union([z.string(), z.object({ entity: z.string(), label: z.string().optional() })]);

const schema = z.object({
  url: z.string().url(),
  /** Long-lived access token (profile → Security). */
  token: z.string().min(1),
  entities: z.array(entity).default([]),
  /** Switches and buttons on the tile for the configured lights, switches, covers, scenes… */
  controls: z.boolean().default(true),
  insecure: z.boolean().optional(),
});
type Cfg = z.infer<typeof schema>;

export interface HaState {
  entity_id: string;
  state: string;
  attributes: { friendly_name?: string; unit_of_measurement?: string };
}

const UNAVAILABLE = new Set(["unavailable", "unknown"]);

/** What each controllable domain may be asked to do (nothing else is ever called). */
const SERVICES: Record<string, string[]> = {
  light: ["turn_on", "turn_off"],
  switch: ["turn_on", "turn_off"],
  fan: ["turn_on", "turn_off"],
  input_boolean: ["turn_on", "turn_off"],
  cover: ["open_cover", "close_cover"],
  scene: ["turn_on"],
  script: ["turn_on"],
};
const domainOf = (id: string) => id.split(".")[0];

/** The one-tap action for an entity in its current state, if it can be controlled. */
export function controlFor(s: HaState | undefined): WidgetField["control"] {
  if (!s) return undefined;
  const d = domainOf(s.entity_id);
  if (["light", "switch", "fan", "input_boolean"].includes(d) && (s.state === "on" || s.state === "off")) {
    return { action: s.state === "on" ? "turn_off" : "turn_on", target: s.entity_id, on: s.state === "on" };
  }
  if (d === "cover" && (s.state === "open" || s.state === "closed")) {
    return { action: s.state === "open" ? "close_cover" : "open_cover", target: s.entity_id, on: s.state === "open" };
  }
  if (d === "scene") return { action: "turn_on", target: s.entity_id, label: "Activate" };
  if (d === "script" && s.state !== "on") return { action: "turn_on", target: s.entity_id, label: "Run" };
  return undefined;
}

const ACTION_LABEL: Record<string, string> = { turn_on: "Turn on", turn_off: "Turn off", open_cover: "Open", close_cover: "Close" };

/** Actions for the configured entities (only those: a whole house would be hundreds). */
export function haActions(states: HaState[], entities: z.infer<typeof entity>[]): ServiceAction[] {
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  return entities.flatMap((e) => {
    const id = typeof e === "string" ? e : e.entity;
    const s = byId.get(id);
    const c = controlFor(s);
    if (!s || !c) return [];
    const d = domainOf(id);
    const label = d === "scene" ? "Activate" : d === "script" ? "Run" : ACTION_LABEL[c.action];
    return [{ id: c.action, label, target: id, targetLabel: (typeof e === "string" ? undefined : e.label) ?? s.attributes.friendly_name ?? id }];
  });
}

function show(s: HaState | undefined, id: string, label: string | undefined, controls: boolean): WidgetField {
  if (!s) return { label: label ?? id, value: "not found", status: "warn" };
  const unit = s.attributes.unit_of_measurement;
  const num = Number(s.state);
  const d = domainOf(id);
  // A scene's state is when it last ran; the tile shows what it is instead.
  const value = d === "scene" ? "scene" : Number.isFinite(num) && s.state.trim() !== "" ? `${Math.round(num * 10) / 10}${unit ? ` ${unit}` : ""}` : s.state;
  const control = controls ? controlFor(s) : undefined;
  return {
    label: label ?? s.attributes.friendly_name ?? id,
    value,
    status: UNAVAILABLE.has(s.state) ? "warn" : undefined,
    ...(control ? { control } : {}),
  };
}

/** Configured entities as fields; without any, a summary of lights, switches and unavailable entities. */
export function parseHomeAssistant(states: HaState[], entities: z.infer<typeof entity>[], controls = false): WidgetResult {
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  const rows = entities.map((e) => (typeof e === "string" ? show(byId.get(e), e, undefined, controls) : show(byId.get(e.entity), e.entity, e.label, controls)));
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
    return parseHomeAssistant(await states(cfg), cfg.entities, cfg.controls);
  },
  actions: {
    async list(cfg) {
      return cfg.controls ? haActions(await states(cfg), cfg.entities) : [];
    },
    async run(cfg, action, target) {
      const d = target ? domainOf(target) : "";
      if (!target || !SERVICES[d]?.includes(action)) throw new Error(`Can't ${action} ${target ?? "that"}`);
      const res = await http(`${trimSlash(cfg.url)}/api/services/${d}/${action}`, {
        method: "POST",
        insecure: cfg.insecure,
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: target }),
      });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`Home Assistant answered HTTP ${res.status}`);
      return `${target}: ${ACTION_LABEL[action]?.toLowerCase() ?? "done"}`;
    },
  },
};

function states(cfg: Cfg) {
  return httpJson<HaState[]>(`${trimSlash(cfg.url)}/api/states`, { insecure: cfg.insecure, headers: { Authorization: `Bearer ${cfg.token}` } });
}
