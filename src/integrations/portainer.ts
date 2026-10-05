import { z } from "zod";
import { httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetField } from "./types";

const schema = z.object({
  url: z.string().url(),
  key: z.string().min(1),
  env: z.coerce.number().int().default(1),
  insecure: z.boolean().optional(),
});

export function parsePortainer(containers: { State: string }[]): WidgetField[] {
  const running = containers.filter((c) => c.State === "running").length;
  const stopped = containers.filter((c) => c.State === "exited" || c.State === "dead").length;
  return [
    { label: "Running", value: running, status: "ok" },
    { label: "Stopped", value: stopped, status: stopped ? "warn" : "ok" },
    { label: "Total", value: containers.length },
  ];
}

export const portainer: Integration<typeof schema> = {
  type: "portainer",
  schema,
  async fetch(cfg) {
    const containers = await httpJson<{ State: string }[]>(
      `${trimSlash(cfg.url)}/api/endpoints/${cfg.env}/docker/containers/json?all=1`,
      { insecure: cfg.insecure, headers: { "X-API-Key": cfg.key } },
    );
    return parsePortainer(containers);
  },
};
