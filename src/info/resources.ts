import { z } from "zod";
import si from "systeminformation";
import type { InfoProvider, ResourcesData } from "./types";

const schema = z.object({
  disks: z.array(z.string()).optional(),
  label: z.string().optional(),
});

export function pickDisks(all: { mount: string; used: number; size: number }[], wanted?: string[]) {
  const norm = (m: string) => m.replace(/[\\/]+$/, "").toLowerCase() || "/";
  let picked = wanted?.length ? all.filter((d) => wanted.some((w) => norm(w) === norm(d.mount))) : [];
  // Nothing configured or nothing matched (e.g. "/" on Windows): show the first filesystem.
  if (!picked.length && all.length) picked = [all.find((d) => d.mount === "/") ?? all[0]];
  return picked.map((d) => ({ mount: d.mount, used: d.used, total: d.size }));
}

export const resources: InfoProvider<typeof schema, ResourcesData> = {
  type: "resources",
  schema,
  ttlMs: 10_000,
  async fetch(cfg) {
    const [load, mem, fs, temp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.cpuTemperature().catch(() => ({ main: null })),
    ]);
    return {
      cpu: load.currentLoad / 100,
      mem: { used: mem.active, total: mem.total },
      disks: pickDisks(fs, cfg.disks),
      temp: typeof temp.main === "number" && temp.main > 0 ? temp.main : null,
      uptime: si.time().uptime,
    };
  },
};
