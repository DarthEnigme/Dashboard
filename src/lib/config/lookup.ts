import { getConfig } from ".";
import { serviceIds } from "./slug";
import { serviceVisibility } from "./sanitize";
import type { Service, Visibility } from "./schema";

/**
 * Resolve a client-visible service id back to its full (secret-bearing) server config.
 * Returns undefined when `canSee` rejects the service's (or its group's) visibility.
 */
export async function findService(id: string, canSee: (v: Visibility) => boolean = () => true): Promise<Service | undefined> {
  const { services } = await getConfig();
  const ids = serviceIds(services);
  for (let g = 0; g < services.length; g++) {
    const s = ids[g].indexOf(id);
    if (s === -1) continue;
    const service = services[g].services[s];
    return canSee(serviceVisibility(services[g], service)) ? service : undefined;
  }
  return undefined;
}
