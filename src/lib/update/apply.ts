import fs from "node:fs";
import os from "node:os";
import { EventEmitter } from "node:events";
import type Docker from "dockerode";
import { dockerClient } from "../docker";
import { getAppMeta, setAppMeta } from "../db";
import { audit } from "../auth/users";
import type { Settings } from "../config/schema";
import { buildInfo } from "../version";
import type { UpdateStatus } from "./check";

export type Phase = "idle" | "preparing" | "pulling" | "restarting" | "failed";

export interface Progress {
  phase: Phase;
  /** 0–100 while pulling. */
  percent?: number;
  message?: string;
  target?: string;
  startedAt?: number;
}

export interface HistoryEntry {
  at: string;
  from: string;
  to: string;
  result: "updated" | "rolled back" | "failed";
  user: string | null;
  detail?: string;
}

interface Pending {
  from: string;
  fromBuild: string;
  to: string;
  image: string;
  user: string | null;
  startedAt: number;
}

const PENDING = "update.pending";
const HISTORY = "update.history";

const g = globalThis as typeof globalThis & { __pageUpdate?: { progress: Progress; events: EventEmitter } };
function state() {
  g.__pageUpdate ??= { progress: { phase: "idle" }, events: new EventEmitter() };
  g.__pageUpdate.events.setMaxListeners(0);
  return g.__pageUpdate;
}

export const updateProgress = () => state().progress;

/** Subscribe to progress changes (the events stream forwards them to open pages). */
export function onUpdateProgress(fn: (p: Progress) => void): () => void {
  state().events.on("progress", fn);
  return () => state().events.off("progress", fn);
}

function setProgress(p: Progress) {
  state().progress = p;
  state().events.emit("progress", p);
}

export const updateHistory = () => getAppMeta<HistoryEntry[]>(HISTORY) ?? [];
function addHistory(e: HistoryEntry) {
  setAppMeta(HISTORY, [e, ...updateHistory()].slice(0, 20));
}

// ---------- preflight ----------

export interface Preflight {
  canApply: boolean;
  /** Why not, in words for the settings page. */
  reason?: string;
  container?: string;
  image?: string;
}

/** This container, found by the id in /proc/self/mountinfo or by hostname (Docker's default). */
async function findSelf(docker: Docker) {
  const ids: string[] = [];
  try {
    const m = fs.readFileSync("/proc/self/mountinfo", "utf8").match(/\/containers\/([0-9a-f]{64})\//);
    if (m) ids.push(m[1]);
  } catch {
    // not Linux
  }
  ids.push(os.hostname());
  for (const id of ids) {
    try {
      return await docker.getContainer(id).inspect();
    } catch {
      // try the next one
    }
  }
  return undefined;
}

/** "ghcr.io/me/page:1.2.3" → "ghcr.io/me/page" (a registry port is not a tag). */
export function imageRepo(ref: string): string {
  const noDigest = ref.split("@")[0];
  const slash = noDigest.lastIndexOf("/");
  const colon = noDigest.lastIndexOf(":");
  return (colon > slash ? noDigest.slice(0, colon) : noDigest).toLowerCase();
}

export async function preflight(cfg: Settings["updates"]): Promise<Preflight & { self?: Docker.ContainerInspectInfo; docker?: Docker }> {
  if (!fs.existsSync("/.dockerenv") && !process.env.PAGE_FORCE_DOCKER) {
    return { canApply: false, reason: "Page isn't running in Docker. Update it the way you installed it (see below)." };
  }
  const docker = dockerClient();
  try {
    await docker.ping();
  } catch {
    return {
      canApply: false,
      reason: "The Docker socket isn't reachable. Mount /var/run/docker.sock into the container to update from here.",
    };
  }
  const self = await findSelf(docker);
  if (!self) return { canApply: false, reason: "Couldn't find this container through the Docker socket." };
  const image = cfg.image || buildInfo().image || imageRepo(self.Config.Image);
  if (!image || /^sha256:/.test(image)) {
    return { canApply: false, reason: "This container runs a locally built image. Set updates.image (e.g. ghcr.io/you/page) to update from a registry." };
  }
  return { canApply: true, container: self.Name.replace(/^\//, ""), image, self, docker };
}

// ---------- apply ----------

/** The release exists but its image doesn't (yet): the build is still running, or it failed. */
export class ImageMissingError extends Error {}

/** Docker's wording for a tag the registry doesn't have. */
export const isMissingImage = (message: string) => /not found|manifest unknown|no such manifest|failed to resolve reference/i.test(message);

function pull(docker: Docker, ref: string, onPercent: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    docker.pull(ref, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      const layers = new Map<string, { current: number; total: number }>();
      docker.modem.followProgress(
        stream,
        (e: Error | null) => (e ? reject(e) : resolve()),
        (ev: { id?: string; status?: string; progressDetail?: { current?: number; total?: number } }) => {
          if (!ev.id) return;
          const d = ev.progressDetail;
          if (ev.status === "Downloading" && d?.total) layers.set(ev.id, { current: d.current ?? 0, total: d.total });
          else if (/complete|Already exists/i.test(ev.status ?? "")) {
            const l = layers.get(ev.id);
            if (l) l.current = l.total;
          }
          let cur = 0;
          let tot = 0;
          for (const l of layers.values()) {
            cur += l.current;
            tot += l.total;
          }
          if (tot) onPercent(Math.min(99, Math.round((cur / tot) * 100)));
        },
      );
    });
  });
}

/**
 * Pull the new image, then hand over to a helper container (scripts/updater.mjs from the new image)
 * that replaces this container. Resolves once the helper is running; this process is then stopped.
 */
export async function applyUpdate(cfg: Settings["updates"], status: UpdateStatus, user: string | null): Promise<void> {
  const busy = updateProgress().phase;
  if (busy === "preparing" || busy === "pulling" || busy === "restarting") throw new Error("An update is already running");
  if (!status.latest) throw new Error("No newer version known; check for updates first");
  const target = status.latest.version;
  setProgress({ phase: "preparing", target, startedAt: Date.now(), message: "Checking Docker…" });
  try {
    const pf = await preflight(cfg);
    if (!pf.canApply || !pf.self || !pf.docker) throw new Error(pf.reason ?? "Can't update here");
    const { docker, self } = pf;
    const ref = `${pf.image}:${status.latest.tag}`;

    audit(user, "update-started", { from: status.current.version, to: target, image: ref });
    setProgress({ phase: "pulling", target, percent: 0, startedAt: Date.now(), message: `Downloading ${ref}` });
    let last = -1;
    await pull(docker, ref, (percent) => {
      if (percent === last) return;
      last = percent;
      setProgress({ ...updateProgress(), percent });
    }).catch((e: Error) => {
      if (!isMissingImage(e.message)) throw e;
      throw new ImageMissingError(`The ${ref} image isn't published yet: its build may still be running, or it failed. Try again later.`);
    });

    // The helper needs the Docker API: the same socket mount, or the same DOCKER_HOST and network.
    const socket = self.Mounts.find((m) => m.Destination === "/var/run/docker.sock");
    const dockerHost = process.env.DOCKER_HOST;
    const network = Object.keys(self.NetworkSettings.Networks ?? {})[0];
    const helper = await docker.createContainer({
      name: `page-updater-${Date.now()}`,
      Image: ref,
      Cmd: ["node", "scripts/updater.mjs", self.Id, ref],
      User: "0",
      WorkingDir: "/app",
      Env: dockerHost ? [`DOCKER_HOST=${dockerHost}`] : [],
      Labels: { "dev.page.role": "updater" },
      HostConfig: {
        AutoRemove: true,
        Binds: socket ? [`${socket.Source}:/var/run/docker.sock`] : [],
        NetworkMode: dockerHost && network ? network : undefined,
      },
    });

    setAppMeta(PENDING, {
      from: status.current.version,
      fromBuild: status.current.buildId,
      to: target,
      image: ref,
      user,
      startedAt: Date.now(),
    } satisfies Pending);
    setProgress({ phase: "restarting", target, percent: 100, startedAt: Date.now(), message: "Restarting with the new version…" });
    await helper.start();
  } catch (e) {
    const message = (e as Error).message;
    setAppMeta(PENDING, undefined);
    audit(user, "update-failed", { to: target, error: message });
    addHistory({ at: new Date().toISOString(), from: status.current.version, to: target, result: "failed", user, detail: message });
    setProgress({ phase: "failed", target, message });
    throw e;
  }
}

/**
 * On startup: if an update was handed over, record how it went. A different build means the new
 * container is the one running; the same build in a process started after the handover means the
 * helper rolled back.
 */
export function reconcilePendingUpdate() {
  const p = getAppMeta<Pending>(PENDING);
  if (!p) return;
  const now = buildInfo();
  const at = new Date().toISOString();
  if (now.buildId !== p.fromBuild) {
    addHistory({ at, from: p.from, to: now.version === p.from ? p.to : now.version, result: "updated", user: p.user });
    audit(p.user, "update-succeeded", { from: p.from, to: p.to });
    setAppMeta(PENDING, undefined);
  } else if (Date.now() - process.uptime() * 1000 > p.startedAt) {
    // Same build, but this process started after the handover: the helper restored the old container.
    addHistory({ at, from: p.from, to: p.to, result: "rolled back", user: p.user, detail: "The new version didn't become healthy; the previous one was restored." });
    audit(p.user, "update-rolled-back", { from: p.from, to: p.to });
    setAppMeta(PENDING, undefined);
  }
}
