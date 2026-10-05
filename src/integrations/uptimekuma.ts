import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";
import { pct } from "./format";

const schema = z.object({
  url: z.string().url(),
  slug: z.string().min(1),
  insecure: z.boolean().optional(),
});

export interface KumaHeartbeats {
  heartbeatList: Record<string, { status: number }[]>;
  uptimeList: Record<string, number>;
}

export interface KumaStatusPage {
  publicGroupList: { monitorList: { id: number; name: string }[] }[];
}

const beatText: Record<number, string> = { 0: "Down", 1: "Up", 2: "Pending", 3: "Maintenance" };

/** Beat status: 0 down, 1 up, 2 pending, 3 maintenance. Uses each monitor's latest beat. */
export function parseUptimeKuma({ heartbeatList, uptimeList }: KumaHeartbeats, page?: KumaStatusPage): WidgetResult {
  const latest = Object.values(heartbeatList)
    .map((beats) => beats.at(-1)?.status)
    .filter((s): s is number => s !== undefined);
  const up = latest.filter((s) => s === 1).length;
  const down = latest.filter((s) => s === 0).length;
  const day = Object.entries(uptimeList)
    .filter(([k]) => k.endsWith("_24"))
    .map(([, v]) => v);
  const fields: WidgetField[] = [
    { label: "Up", value: up, status: "ok" },
    { label: "Down", value: down, status: down ? "error" : "ok" },
  ];
  if (day.length) {
    const avg = day.reduce((a, b) => a + b, 0) / day.length;
    fields.push({ label: "Uptime 24h", value: pct(avg), status: avg < 0.99 ? "warn" : "ok" });
  }
  const names = new Map(page?.publicGroupList.flatMap((g) => g.monitorList.map((m) => [String(m.id), m.name] as const)) ?? []);
  const list: WidgetField[] = Object.entries(heartbeatList).map(([id, beats]) => {
    const s = beats.at(-1)?.status;
    const up = uptimeList[`${id}_24`];
    return {
      label: names.get(id) ?? `Monitor ${id}`,
      value: `${s === undefined ? "–" : beatText[s]}${up !== undefined ? ` · ${pct(up)}` : ""}`,
      status: s === 0 ? "error" : s === 1 ? undefined : "warn",
    };
  });
  return { fields, list };
}

export const uptimekuma: Integration<typeof schema> = {
  type: "uptimekuma",
  schema,
  async fetch(cfg) {
    const base = `${trimSlash(cfg.url)}/api/status-page`;
    const slug = encodeURIComponent(cfg.slug);
    const [beats, page] = await Promise.all([
      httpJson<KumaHeartbeats>(`${base}/heartbeat/${slug}`, { insecure: cfg.insecure }),
      // Only needed for monitor names; the widget still works without it.
      httpJson<KumaStatusPage>(`${base}/${slug}`, { insecure: cfg.insecure }).catch(() => undefined),
    ]);
    return parseUptimeKuma(beats, page);
  },
};
