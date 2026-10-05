import { z } from "zod";
import { httpJson } from "@/lib/http";
import type { Integration, WidgetField } from "./types";
import { bytes, duration } from "./format";

const formats = ["text", "number", "percent", "bytes", "duration"] as const;

const schema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  insecure: z.boolean().optional(),
  mappings: z
    .array(
      z.object({
        label: z.string(),
        field: z.string(),
        format: z.enum(formats).default("text"),
        suffix: z.string().optional(),
      }),
    )
    .default([]),
});

/** Read "a.b[0].c" (or "a.b.0.c") from parsed JSON. */
export function getPath(obj: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((v, k) => (v != null && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), obj);
}

export function formatValue(v: unknown, format: (typeof formats)[number]): string | number {
  if (v === undefined || v === null) return "–";
  const n = Number(v);
  switch (format) {
    case "number":
      return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v);
    case "percent":
      return Number.isFinite(n) ? `${n.toFixed(n < 10 ? 1 : 0)}%` : String(v);
    case "bytes":
      return Number.isFinite(n) ? bytes(n) : String(v);
    case "duration":
      return Number.isFinite(n) ? duration(n) : String(v);
    default:
      return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

export function parseCustom(data: unknown, mappings: z.infer<typeof schema>["mappings"]): WidgetField[] {
  if (!mappings.length) {
    // No mappings: show the first few scalar top-level values so the widget is useful straight away.
    const entries = data && typeof data === "object" ? Object.entries(data) : [["value", data] as const];
    return entries
      .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
      .slice(0, 4)
      .map(([k, v]) => ({ label: String(k), value: formatValue(v, "text") }));
  }
  return mappings.map((m) => {
    const value = formatValue(getPath(data, m.field), m.format);
    return { label: m.label, value: m.suffix && value !== "–" ? `${value}${m.suffix}` : value };
  });
}

export const customapi: Integration<typeof schema> = {
  type: "customapi",
  schema,
  async fetch(cfg) {
    const data = await httpJson<unknown>(cfg.url, {
      method: cfg.method,
      headers: { ...(cfg.body ? { "Content-Type": "application/json" } : {}), ...cfg.headers },
      body: cfg.method === "POST" ? cfg.body : undefined,
      insecure: cfg.insecure,
    });
    return parseCustom(data, cfg.mappings);
  },
};
