import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField, WidgetResult } from "./types";
import { duration } from "./format";

// Frigate (NVR), Scrutiny (disk S.M.A.R.T.), Gotify and ntfy (notifications).

const base = z.object({ url: z.string().url(), insecure: z.boolean().optional() });

// ---------- Frigate ----------

export interface FrigateStats {
  cameras: Record<string, { camera_fps: number; detection_fps?: number; process_fps?: number }>;
  detectors?: Record<string, { inference_speed?: number }>;
  service?: { uptime?: number; version?: string };
}

export function parseFrigate(s: FrigateStats, eventsToday?: number): WidgetResult {
  const cams = Object.entries(s.cameras ?? {});
  const online = cams.filter(([, c]) => c.camera_fps > 0).length;
  const inference = Object.values(s.detectors ?? {})
    .map((d) => d.inference_speed)
    .filter((v): v is number => typeof v === "number");
  const fields: WidgetField[] = [
    { label: "Cameras", value: `${online} / ${cams.length}`, status: online < cams.length ? "error" : "ok" },
    ...(inference.length ? [{ label: "Inference", value: `${Math.max(...inference).toFixed(1)} ms`, raw: Math.max(...inference) }] : []),
    ...(eventsToday !== undefined ? [{ label: "Events today", value: eventsToday }] : []),
    ...(s.service?.uptime ? [{ label: "Uptime", value: duration(s.service.uptime) }] : []),
  ];
  return {
    fields,
    list: cams.map(([name, c]) => ({ label: name, value: c.camera_fps > 0 ? `${c.camera_fps.toFixed(0)} fps · detect ${(c.detection_fps ?? 0).toFixed(1)}` : "offline", status: c.camera_fps > 0 ? undefined : ("error" as const) })),
  };
}

export const frigate: Integration<typeof base> = {
  type: "frigate",
  schema: base,
  async fetch(cfg) {
    const b = trimSlash(cfg.url);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const [stats, events] = await Promise.all([
      httpJson<FrigateStats>(`${b}/api/stats`, { insecure: cfg.insecure }),
      httpJson<unknown[]>(`${b}/api/events?after=${Math.floor(midnight.getTime() / 1000)}&limit=500`, { insecure: cfg.insecure }).catch(() => undefined),
    ]);
    return parseFrigate(stats, events?.length);
  },
};

// ---------- Scrutiny ----------

export interface ScrutinySummary {
  data: {
    summary: Record<string, { device: { device_name?: string; model_name?: string; device_status: number }; smart?: { temp?: number; power_on_hours?: number } }>;
  };
}

/** device_status: 0 = passed; bit 1 = failed S.M.A.R.T., bit 2 = failed Scrutiny thresholds. */
export function parseScrutiny(s: ScrutinySummary): WidgetResult {
  const disks = Object.values(s.data.summary ?? {});
  const failed = disks.filter((d) => d.device.device_status !== 0);
  const temps = disks.map((d) => d.smart?.temp).filter((t): t is number => typeof t === "number" && t > 0);
  const hottest = temps.length ? Math.max(...temps) : undefined;
  return {
    fields: [
      { label: "Disks", value: disks.length },
      { label: "Failing", value: failed.length, status: failed.length ? "error" : "ok" },
      ...(hottest !== undefined ? [{ label: "Hottest", value: `${hottest} °C`, raw: hottest, status: hottest >= 55 ? ("error" as const) : hottest >= 45 ? ("warn" as const) : undefined }] : []),
    ],
    list: disks
      .sort((a, b) => b.device.device_status - a.device.device_status)
      .map((d) => ({
        label: `${d.device.device_name ?? "?"} ${d.device.model_name ?? ""}`.trim(),
        value: `${d.device.device_status ? "failing" : "passed"}${d.smart?.temp ? ` · ${d.smart.temp} °C` : ""}`,
        status: d.device.device_status ? ("error" as const) : undefined,
      })),
  };
}

export const scrutiny: Integration<typeof base> = {
  type: "scrutiny",
  schema: base,
  async fetch(cfg) {
    return parseScrutiny(await httpJson<ScrutinySummary>(`${trimSlash(cfg.url)}/api/summary`, { insecure: cfg.insecure }));
  },
};

// ---------- Gotify ----------

export interface GotifyMessage {
  title?: string;
  message: string;
  priority?: number;
  date: string;
}

/** Gotify reports no message total: show how many recent ones there are ("10+" when it has more). */
export function parseGotify(apps: unknown[], clients: unknown[], messages: GotifyMessage[], more: boolean): WidgetResult {
  return {
    fields: [
      { label: "Apps", value: apps.length },
      { label: "Clients", value: clients.length },
      { label: "Messages", value: `${messages.length}${more ? "+" : ""}` },
    ],
    compactList: 2,
    list: messages.map((m) => ({ label: m.title || m.message.slice(0, 40), value: new Date(m.date).toLocaleDateString([], { month: "short", day: "numeric" }), status: (m.priority ?? 0) >= 8 ? ("error" as const) : undefined })),
  };
}

const gotifySchema = base.extend({ key: z.string().min(1) });
export const gotify: Integration<typeof gotifySchema> = {
  type: "gotify",
  schema: gotifySchema,
  async fetch(cfg) {
    const b = trimSlash(cfg.url);
    const opts = { insecure: cfg.insecure, headers: { "X-Gotify-Key": cfg.key } };
    const [apps, clients, msgs] = await Promise.all([
      httpJson<unknown[]>(`${b}/application`, opts),
      httpJson<unknown[]>(`${b}/client`, opts).catch(() => []),
      httpJson<{ messages: GotifyMessage[]; paging: { size: number; next?: string } }>(`${b}/message?limit=10`, opts),
    ]);
    return parseGotify(apps, clients, msgs.messages, !!msgs.paging.next);
  },
};

// ---------- ntfy ----------

export interface NtfyStats {
  messages: number;
  messages_rate: number;
}

export const parseNtfy = (s: NtfyStats): WidgetField[] => [
  { label: "Messages", value: s.messages.toLocaleString("en-US"), raw: s.messages },
  { label: "Per second", value: s.messages_rate.toFixed(2), raw: s.messages_rate },
];

/** Needs `enable-metrics` or a public /v1/stats (on by default). */
export const ntfy: Integration<typeof base> = {
  type: "ntfy",
  schema: base,
  async fetch(cfg) {
    return parseNtfy(await httpJson<NtfyStats>(`${trimSlash(cfg.url)}/v1/stats`, { insecure: cfg.insecure }));
  },
};
