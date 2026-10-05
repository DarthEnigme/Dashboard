import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField } from "./types";
import { bytes, loadStatus, pct } from "./format";

const schema = z.object({
  url: z.string().url(),
  /** API key and secret (System → Access → Users → API keys). */
  username: z.string().min(1),
  password: z.string().min(1),
  /** Interface to show traffic for. */
  wan: z.string().default("wan"),
  insecure: z.boolean().default(true),
});

export interface OpnActivity {
  headers?: string[];
}
export interface OpnTraffic {
  interfaces?: Record<string, { name?: string; "bytes received"?: string | number; "bytes transmitted"?: string | number }>;
}
export interface OpnFirmware {
  status?: string;
  product_version?: string;
  updates?: string | number;
}

/** CPU from top's header ("CPU: 2.3% user, … 95.1% idle"), WAN totals and pending updates. */
export function parseOpnsense(activity: OpnActivity, traffic: OpnTraffic, firmware: OpnFirmware | undefined, wan: string): WidgetField[] {
  const cpuLine = activity.headers?.find((h) => /^CPU/i.test(h.trim()));
  const idle = cpuLine?.match(/([\d.]+)%\s+idle/);
  const cpu = idle ? 1 - Number(idle[1]) / 100 : undefined;
  const iface = traffic.interfaces?.[wan] ?? Object.values(traffic.interfaces ?? {}).find((i) => i.name?.toLowerCase() === wan.toLowerCase());
  const fields: WidgetField[] = [
    { label: "CPU", value: cpu === undefined ? "–" : pct(cpu), status: cpu === undefined ? undefined : loadStatus(cpu), raw: cpu === undefined ? undefined : cpu * 100 },
    { label: "WAN ↓", value: iface ? bytes(Number(iface["bytes received"] ?? 0)) : "–" },
    { label: "WAN ↑", value: iface ? bytes(Number(iface["bytes transmitted"] ?? 0)) : "–" },
  ];
  if (firmware) {
    const pending = firmware.status === "update" || firmware.status === "upgrade" || Number(firmware.updates ?? 0) > 0;
    fields.push({ label: "Updates", value: pending ? "available" : "none", status: pending ? "warn" : "ok" });
  }
  return fields;
}

export const opnsense: Integration<typeof schema> = {
  type: "opnsense",
  schema,
  async fetch(cfg) {
    const base = trimSlash(cfg.url);
    const opts = { insecure: cfg.insecure, headers: { Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}` } };
    const [activity, traffic, firmware] = await Promise.all([
      httpJson<OpnActivity>(`${base}/api/diagnostics/activity/getActivity`, opts),
      httpJson<OpnTraffic>(`${base}/api/diagnostics/traffic/interface`, opts),
      httpJson<OpnFirmware>(`${base}/api/core/firmware/status`, opts).catch(() => undefined),
    ]);
    return parseOpnsense(activity, traffic, firmware, cfg.wan);
  },
};
