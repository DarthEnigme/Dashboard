import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";
import { loadStatus } from "./format";

const schema = z.object({
  url: z.string().url(),
  /** REST API package key (System → REST API → Keys). */
  key: z.string().min(1),
  insecure: z.boolean().default(true),
});

export interface PfSystem {
  cpu_usage?: number;
  mem_usage?: number;
  disk_usage?: number;
  temp_c?: number | null;
}
export interface PfGateway {
  name: string;
  status?: string;
  delay?: string | number;
  loss?: string | number;
}

const percentField = (label: string, v: number | undefined): WidgetField =>
  v === undefined ? { label, value: "–" } : { label, value: `${Math.round(v)}%`, status: loadStatus(v / 100), raw: v };

/** pfSense REST API v2: system load and gateway state. */
export function parsePfsense(system: PfSystem, gateways: PfGateway[]): WidgetResult {
  const down = gateways.filter((g) => g.status && !/^(online|none)$/i.test(g.status));
  const fields: WidgetField[] = [percentField("CPU", system.cpu_usage), percentField("RAM", system.mem_usage), percentField("Disk", system.disk_usage)];
  if (system.temp_c != null) fields.push({ label: "Temp", value: `${Math.round(system.temp_c)} °C`, raw: system.temp_c });
  if (gateways.length) fields.push({ label: "Gateways", value: `${gateways.length - down.length} / ${gateways.length}`, status: down.length ? "error" : "ok" });
  return {
    fields,
    list: gateways.map((g) => ({
      label: g.name,
      value: g.status && !/^(online|none)$/i.test(g.status) ? g.status : `${g.delay ?? "?"} · loss ${g.loss ?? "?"}`,
      status: g.status && !/^(online|none)$/i.test(g.status) ? ("error" as const) : undefined,
    })),
  };
}

export const pfsense: Integration<typeof schema> = {
  type: "pfsense",
  schema,
  async fetch(cfg) {
    const base = trimSlash(cfg.url);
    const opts = { insecure: cfg.insecure, headers: { "X-API-Key": cfg.key } };
    const [system, gateways] = await Promise.all([
      httpJson<{ data: PfSystem }>(`${base}/api/v2/status/system`, opts),
      httpJson<{ data: PfGateway[] }>(`${base}/api/v2/status/gateways`, opts).catch(() => ({ data: [] as PfGateway[] })),
    ]);
    return parsePfsense(system.data, gateways.data);
  },
};
