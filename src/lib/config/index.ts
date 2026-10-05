import { loadConfig, type LoadedConfig } from "./load";
import { noteDiscovered } from "./watch";
import { discover, mergeDiscovered } from "../discovery";

/** File config plus services discovered from Docker labels (when enabled). */
export async function getConfig(): Promise<LoadedConfig> {
  const cfg = loadConfig();
  const { discovery, hosts } = cfg.settings.docker;
  if (!discovery || !hosts.length) return cfg;
  const found = await discover(hosts);
  noteDiscovered(JSON.stringify(found.services));
  return {
    ...cfg,
    services: mergeDiscovered(cfg.services, found.services),
    errors: [...cfg.errors, ...found.errors],
  };
}
