import type Docker from "dockerode";

/**
 * Is a newer image published for a container? The Docker daemon asks the registry for the tag's
 * current digest (GET /distribution/<ref>/json, with the daemon's own registry logins) and that
 * is compared with the digests the local image was pulled as.
 */
export type ImageState = "update" | "current" | "local" | "pinned" | "unknown";

export interface ImageCheck {
  state: ImageState;
  checkedAt: number;
  error?: string;
}

/** Registries rate-limit; a tag rarely changes more often than this matters. */
export const CHECK_TTL = 6 * 60 * 60_000;
/** After a failure (offline, rate limited), try again sooner. */
const RETRY_TTL = 30 * 60_000;

type Client = Pick<Docker, "getImage">;

/**
 * The registry has no such image, or won't show it to us: built locally (Docker Desktop records
 * digests for those too), or private without a login. Not worth retrying or warning about.
 */
const NOT_PUBLISHED = /denied|unauthorized|authentication required|not found|manifest unknown|no such|repository does not exist/i;

export async function checkImage(client: Client, ref: string, now = Date.now()): Promise<ImageCheck> {
  if (ref.includes("@sha256:")) return { state: "pinned", checkedAt: now };
  try {
    const local = await client.getImage(ref).inspect();
    const digests = (local.RepoDigests ?? []).map((d) => d.slice(d.indexOf("@") + 1));
    // Built here, never pulled: there is nothing to compare with.
    if (!digests.length) return { state: "local", checkedAt: now };
    const remote = await client.getImage(ref).distribution();
    const digest = remote.Descriptor?.digest;
    if (!digest) return { state: "unknown", checkedAt: now, error: "The registry sent no digest" };
    return { state: digests.includes(digest) ? "current" : "update", checkedAt: now };
  } catch (e) {
    const error = (e as Error).message;
    return { state: NOT_PUBLISHED.test(error) ? "local" : "unknown", checkedAt: now, error };
  }
}

const g = globalThis as typeof globalThis & { __pageImageChecks?: Map<string, ImageCheck>; __pageImageInflight?: Map<string, Promise<ImageCheck>> };
const cache = (g.__pageImageChecks ??= new Map());
const inflight = (g.__pageImageInflight ??= new Map());

/**
 * The last known answer for an image, refreshed in the background when it's old: widgets never
 * wait on a registry. `imageId` is part of the key, so pulling a new image re-checks at once.
 */
export function imageUpdate(client: Client, host: string | undefined, ref: string, imageId: string, now = Date.now()): ImageCheck | undefined {
  const key = `${host ?? ""}|${ref}|${imageId}`;
  const hit = cache.get(key);
  const ttl = hit?.state === "unknown" ? RETRY_TTL : CHECK_TTL;
  if ((!hit || now - hit.checkedAt > ttl) && !inflight.has(key)) {
    const p = checkImage(client, ref, now)
      .then((r) => {
        cache.set(key, r);
        if (r.state === "unknown" && r.error) console.warn(`[page] image update check for ${ref} failed: ${r.error}`);
        return r;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return hit;
}

/** Waits for checks that are running (tests, and the first load of a service page). */
export const pendingImageChecks = () => Promise.all(inflight.values());
