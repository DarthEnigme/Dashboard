import { z } from "zod";
import { dockerClient } from "@/lib/docker";
import { imageUpdate, type ImageCheck } from "@/lib/imageUpdates";
import type { Integration, ServiceAction, WidgetField } from "./types";
import { bytes, duration, loadStatus, pct } from "./format";

const schema = z.object({
  container: z.string().min(1),
  host: z.string().optional(),
  /** Check the registry for a newer image of the container's tag (every 6 hours). */
  updates: z.boolean().default(true),
});

export interface DockerStats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; stats?: { inactive_file?: number; cache?: number } };
}

export interface DockerState {
  Status: string;
  StartedAt: string;
  Health?: { Status: string };
}

/** Only a newer image is worth a field; "up to date" would crowd every Docker tile. */
export function imageField(check: ImageCheck | undefined): WidgetField[] {
  return check?.state === "update" ? [{ label: "Image", value: "update available", status: "warn" }] : [];
}

export function parseDocker(state: DockerState, stats?: DockerStats, now = Date.now()): WidgetField[] {
  const running = state.Status === "running";
  const health = state.Health?.Status;
  const fields: WidgetField[] = [
    {
      label: "Status",
      value: health && health !== "none" ? `${state.Status} · ${health}` : state.Status,
      status: !running ? "error" : health === "unhealthy" ? "warn" : "ok",
    },
  ];
  if (!running) return fields;
  fields.push({ label: "Uptime", value: duration((now - Date.parse(state.StartedAt)) / 1000) });
  if (stats) {
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const sysDelta = (stats.cpu_stats.system_cpu_usage ?? 0) - (stats.precpu_stats.system_cpu_usage ?? 0);
    const cpu = sysDelta > 0 ? (cpuDelta / sysDelta) * (stats.cpu_stats.online_cpus ?? 1) : 0;
    const cache = stats.memory_stats.stats?.inactive_file ?? stats.memory_stats.stats?.cache ?? 0;
    const mem = Math.max((stats.memory_stats.usage ?? 0) - cache, 0);
    fields.push({ label: "CPU", value: pct(cpu), status: loadStatus(cpu) });
    fields.push({ label: "RAM", value: bytes(mem) });
  }
  return fields;
}

export const docker: Integration<typeof schema> = {
  type: "docker",
  schema,
  async fetch(cfg) {
    const client = dockerClient(cfg.host);
    const c = client.getContainer(cfg.container);
    const info = await c.inspect();
    const stats =
      info.State.Status === "running"
        ? ((await c.stats({ stream: false })) as unknown as DockerStats)
        : undefined;
    const update = cfg.updates ? imageUpdate(client, cfg.host, info.Config.Image, info.Image) : undefined;
    return [...parseDocker(info.State, stats), ...imageField(update)];
  },
  actions: {
    async list(cfg) {
      const { State } = await dockerClient(cfg.host).getContainer(cfg.container).inspect();
      return dockerActions(State.Status);
    },
    async run(cfg, action) {
      const c = dockerClient(cfg.host).getContainer(cfg.container);
      if (action === "start") await c.start();
      else if (action === "stop") await c.stop();
      else if (action === "restart") await c.restart();
      else throw new Error(`Unknown action "${action}"`);
      return `${cfg.container}: ${action === "stop" ? "stopped" : action === "start" ? "started" : "restarted"}`;
    },
  },
};

export function dockerActions(status: string): ServiceAction[] {
  return status === "running"
    ? [
        { id: "restart", label: "Restart" },
        { id: "stop", label: "Stop", danger: true },
      ]
    : [{ id: "start", label: "Start" }];
}
