import { z } from "zod";
import { fetchGlances, glancesConnection } from "@/integrations/glances";
import { pickDisks } from "./resources";
import type { InfoProvider, ResourcesData } from "./types";

const schema = z.object({
  ...glancesConnection,
  label: z.string().optional(),
  disks: z.array(z.string()).optional(),
});

/** "3 days, 4:05:06" -> seconds. */
export function uptimeSeconds(s?: string): number {
  const m = /(?:(\d+) days?, )?(\d+):(\d+):(\d+)/.exec(s ?? "");
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]) : 0;
}

/** The "resources" meters for another machine, through its Glances API. */
export const glancesInfo: InfoProvider<typeof schema, ResourcesData> = {
  type: "glances",
  schema,
  ttlMs: 10_000,
  async fetch(cfg) {
    const d = await fetchGlances({ ...cfg, chart: false });
    const temps = (d.sensors ?? []).filter((s) => /temp/i.test(s.type ?? "") || s.unit === "C").map((s) => s.value);
    return {
      cpu: d.quicklook.cpu / 100,
      mem: d.mem ? { used: d.mem.used, total: d.mem.total } : { used: d.quicklook.mem, total: 100 },
      disks: pickDisks(d.fs.map((f) => ({ mount: f.mnt_point, used: f.used, size: f.size })), cfg.disks),
      temp: temps.length ? Math.max(...temps) : null,
      uptime: uptimeSeconds(d.uptime),
    };
  },
};
