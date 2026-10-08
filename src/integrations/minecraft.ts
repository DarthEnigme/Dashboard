import { z } from "zod";
import { mcStatus, type McStatus } from "@/lib/minecraft";
import type { Integration, WidgetResult } from "./types";

const schema = z.object({
  host: z.string().min(1),
  /** Default 25565 (Java) or 19132 (Bedrock). */
  port: z.coerce.number().int().min(1).max(65535).optional(),
  edition: z.enum(["java", "bedrock"]).default("java"),
});

export function minecraftResult(s: McStatus): WidgetResult {
  const full = s.max > 0 && s.online >= s.max;
  return {
    fields: [
      { label: "Players", value: `${s.online} / ${s.max}`, raw: s.online, status: full ? "warn" : "ok" },
      { label: "Version", value: s.version || "–" },
      { label: "Ping", value: `${s.latencyMs} ms`, raw: s.latencyMs },
    ],
    list: [
      ...(s.motd ? [{ label: "MOTD", value: s.motd }] : []),
      ...s.players.map((p) => ({ label: p, value: "online", status: "ok" as const })),
    ],
  };
}

/** Minecraft server status (Java or Bedrock): players, version, ping and who is online. No plugin needed. */
export const minecraft: Integration<typeof schema> = {
  type: "minecraft",
  schema,
  async fetch(cfg) {
    return minecraftResult(await mcStatus(cfg.edition, cfg.host, cfg.port));
  },
};
