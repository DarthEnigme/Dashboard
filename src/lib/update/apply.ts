import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import type Docker from "dockerode";
import { dockerClient } from "../docker";
import { db, getAppMeta, setAppMeta, transaction } from "../db";
import { snapshotDb } from "../snapshots";
import { hasAlertChannel, sendNotice } from "../alerts";
import { loadConfig } from "../config/load";
import { audit } from "../auth/users";
import type { Settings } from "../config/schema";
import { buildInfo } from "../version";
import type { UpdateStatus } from "./check";
import { clearJournal, LEGACY_PENDING, readJournal, writeJournal, type Journal, type RestoredDb } from "./journal";

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

const HISTORY = "update.history";
/**
 * Longer than the helper can take (scripts/updater.mjs waits up to 240 s for the new container to be
 * healthy). The old process still alive after this: the helper gave up before stopping it. The new
 * process alive after this: the helper kept it, so the update can be recorded as done.
 */
const HANDOVER_TIMEOUT_MS = 5 * 60_000;

const g = globalThis as typeof globalThis & { __pageUpdate?: { progress: Progress; events: EventEmitter }; __pageBootId?: string };
/** This process, for the journal: a later process of the same build means the helper put this one back. */
export const bootId = () => (g.__pageBootId ??= crypto.randomUUID());
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
    return { canApply: false, reason: "NanoDash isn't running in Docker. Update it the way you installed it (see below)." };
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
  let helper: Docker.Container | undefined;
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
    helper = await docker.createContainer({
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

    const journal: Journal = {
      from: status.current.version,
      fromBuild: status.current.buildId,
      to: target,
      image: ref,
      user,
      startedAt: Date.now(),
      bootId: bootId(),
      snapshot: snapshotDb(`pre-update-${status.current.version}-to-${target}`, db()),
    };
    writeJournal(journal);
    setProgress({ phase: "restarting", target, percent: 100, startedAt: Date.now(), message: "Restarting with the new version…" });
    await helper.start();
    setTimeout(() => handoverTimedOut(journal), HANDOVER_TIMEOUT_MS).unref();
  } catch (e) {
    const message = (e as Error).message;
    await helper?.remove({ force: true }).catch(() => undefined);
    record({ at: new Date().toISOString(), from: status.current.version, to: target, result: "failed", user, detail: message }, "update-failed", { error: message });
    setProgress({ phase: "failed", target, message });
    throw e;
  }
}

/**
 * Add a history entry and its audit line in one transaction, then drop the update record (and the
 * one 0.6.0 left in app_meta). In that order: a crash in between repeats an entry, never loses one.
 */
function record(entry: HistoryEntry, action: string, detail: Record<string, unknown> = {}) {
  transaction(() => {
    addHistory(entry);
    audit(entry.user, action, { from: entry.from, to: entry.to, ...detail });
    setAppMeta(LEGACY_PENDING, undefined);
  });
  clearJournal();
}

/** Still running long after the handover: the helper failed before it stopped this container. */
function handoverTimedOut(j: Journal) {
  if (updateProgress().phase !== "restarting" || readJournal()?.startedAt !== j.startedAt) return;
  const message = "The updater never replaced this container; NanoDash kept running the current version.";
  record({ at: new Date().toISOString(), from: j.from, to: j.to, result: "failed", user: j.user, detail: message }, "update-failed", { error: message });
  setProgress({ phase: "failed", target: j.to, message });
}

/** What reconcilePendingUpdate recorded, for the caller to announce. */
export interface Reconciled {
  entry: HistoryEntry;
  /** Set when the rollback also put the database back. */
  restored?: RestoredDb;
}

/**
 * On startup: if an update was handed over, record how it went.
 * - A different build: this is the new version. The helper can still roll it back until its health
 *   wait is over, and the old version then needs the record, so it is recorded as done only after that.
 * - The same build in a later process: the helper put the old container back.
 * - The same process: the handover is still going on.
 */
export function reconcilePendingUpdate(): Reconciled | undefined {
  const j = readJournal() ?? getAppMeta<Journal>(LEGACY_PENDING);
  if (!j) return undefined;
  const now = buildInfo();
  if (now.buildId !== j.fromBuild) {
    const settleIn = HANDOVER_TIMEOUT_MS - process.uptime() * 1000;
    if (settleIn > 0) {
      setTimeout(() => {
        try {
          reconcilePendingUpdate();
        } catch (e) {
          console.warn("[nanodash] could not record the last update:", e);
        }
      }, settleIn).unref();
      return undefined;
    }
    // The new version normally reports the version it was asked for; a different tag reports its own.
    const entry: HistoryEntry = { at: new Date().toISOString(), from: j.from, to: now.version === j.from ? j.to : now.version, result: "updated", user: j.user };
    record(entry, "update-succeeded");
    return { entry };
  }
  if (j.bootId === bootId()) return undefined;
  const { restored } = j;
  const detail = restored
    ? `The new version didn't become healthy; the previous one was restored, with the database as it was before the update. Anything saved in ${j.to} meanwhile is only in data/${path.basename(restored.kept)}.`
    : "The new version didn't become healthy; the previous one was restored.";
  const entry: HistoryEntry = { at: new Date().toISOString(), from: j.from, to: j.to, result: "rolled back", user: j.user, detail };
  record(entry, "update-rolled-back", restored ? { restoredFrom: restored.snapshot, kept: restored.kept } : {});
  return { entry, restored };
}

/** Tell the alert channels about a rolled-back update (an error when the database was put back too). */
export async function announceUpdateOutcome({ entry, restored }: Reconciled) {
  if (entry.result !== "rolled back") return;
  const { alerts } = loadConfig().settings;
  if (!hasAlertChannel(alerts)) return;
  await sendNotice(alerts, { kind: "update", level: restored ? "error" : "warn", message: `Update to ${entry.to} rolled back. ${entry.detail}` });
}
