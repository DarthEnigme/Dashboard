import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";
import { bytes, loadStatus, pct } from "./format";

export const glancesConnection = {
  url: z.string().url(),
  /** REST API version: 4 for Glances 4.x, 3 for 3.x. */
  version: z.coerce.number().int().min(3).max(4).default(4),
  username: z.string().optional(),
  password: z.string().optional(),
  insecure: z.boolean().optional(),
};

const schema = z.object({
  ...glancesConnection,
  /** Mount points to list (default: all real filesystems). */
  disks: z.array(z.string()).optional(),
  /** Draw a CPU sparkline (tiles bigger than small). */
  chart: z.boolean().default(true),
});

export interface GlancesQuicklook {
  cpu: number;
  mem: number;
  swap?: number;
  load?: number;
  cpu_name?: string;
}
export interface GlancesFs {
  mnt_point: string;
  device_name?: string;
  fs_type?: string;
  size: number;
  used: number;
  percent: number;
}
export interface GlancesSensor {
  label: string;
  value: number;
  unit?: string;
  type?: string;
}

export interface GlancesData {
  quicklook: GlancesQuicklook;
  fs: GlancesFs[];
  sensors?: GlancesSensor[];
  uptime?: string;
  load?: { min1: number; min5: number; min15: number; cpucore?: number };
  mem?: { total: number; used: number; percent: number };
  cpuHistory?: number[];
}

export function parseGlances(d: GlancesData, disks?: string[]): WidgetResult {
  const fs = d.fs.filter((f) => (disks ? disks.includes(f.mnt_point) : f.size > 0 && !/^(tmpfs|overlay|squashfs)$/.test(f.fs_type ?? "")));
  const fullest = fs.reduce<GlancesFs | undefined>((a, f) => (!a || f.percent > a.percent ? f : a), undefined);
  const temps = (d.sensors ?? []).filter((s) => /temp/i.test(s.type ?? "") || s.unit === "C");
  const hottest = temps.reduce<GlancesSensor | undefined>((a, s) => (!a || s.value > a.value ? s : a), undefined);

  const result: WidgetResult = {
    fields: [
      { label: "CPU", value: pct(d.quicklook.cpu / 100), status: loadStatus(d.quicklook.cpu / 100) },
      { label: "RAM", value: pct(d.quicklook.mem / 100), status: loadStatus(d.quicklook.mem / 100) },
    ],
  };
  if (fullest) result.fields.push({ label: "Disk", value: pct(fullest.percent / 100), status: loadStatus(fullest.percent / 100) });
  if (hottest) result.fields.push({ label: "Temp", value: `${Math.round(hottest.value)}°`, status: hottest.value >= 85 ? "error" : hottest.value >= 75 ? "warn" : "ok" });
  if (d.load) result.fields.push({ label: "Load", value: d.load.min5.toFixed(2), status: d.load.cpucore ? loadStatus(d.load.min5 / d.load.cpucore) : undefined });
  if (d.uptime) result.fields.push({ label: "Uptime", value: shortUptime(d.uptime) });
  result.list = fs.map((f) => ({ label: f.mnt_point, value: `${bytes(f.used)} / ${bytes(f.size)}`, status: f.percent >= 90 ? "error" : f.percent >= 80 ? "warn" : undefined }));
  if (d.cpuHistory?.length) result.sparks = [{ label: "CPU", values: d.cpuHistory, current: pct(d.quicklook.cpu / 100), unit: "%", max: 100 }];
  return result;
}

/** "12 days, 3:04:05" -> "12d 3h"; "3:04:05" -> "3h 4m". */
export function shortUptime(s: string): string {
  const m = /(?:(\d+) days?, )?(\d+):(\d+):\d+/.exec(s);
  if (!m) return s;
  const [, d, h, min] = m;
  return d ? `${d}d ${Number(h)}h` : Number(h) ? `${Number(h)}h ${Number(min)}m` : `${Number(min)}m`;
}

export function glancesClient(cfg: { url: string; version: number; username?: string; password?: string; insecure?: boolean }) {
  const headers: Record<string, string> = {};
  if (cfg.username) headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password ?? ""}`).toString("base64")}`;
  return <T,>(path: string) => httpJson<T>(`${trimSlash(cfg.url)}/api/${cfg.version}/${path}`, { headers, insecure: cfg.insecure });
}

export async function fetchGlances(cfg: z.infer<typeof schema> | (Omit<z.infer<typeof schema>, "chart" | "disks"> & { chart?: boolean })): Promise<GlancesData> {
  const get = glancesClient(cfg);
  const opt = <T,>(p: Promise<T>) => p.catch(() => undefined);
  const [quicklook, fs, sensors, uptime, load, mem, history] = await Promise.all([
    get<GlancesQuicklook>("quicklook"),
    opt(get<GlancesFs[]>("fs")),
    opt(get<GlancesSensor[]>("sensors")),
    opt(get<string>("uptime")),
    opt(get<GlancesData["load"]>("load")),
    opt(get<GlancesData["mem"]>("mem")),
    cfg.chart ? opt(get<{ total: [string, number][] }>("cpu/total/history/30")) : undefined,
  ]);
  return { quicklook, fs: fs ?? [], sensors, uptime, load, mem, cpuHistory: history?.total?.map(([, v]) => v) };
}

/** Glances: CPU, RAM, disk, temperature and load of any machine running `glances -w`. */
export const glances: Integration<typeof schema> = {
  type: "glances",
  schema,
  async fetch(cfg) {
    return parseGlances(await fetchGlances(cfg), cfg.disks);
  },
};
