import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { CONFIG_DIR, invalidate } from "./load";

export interface ConfigChange {
  file: string;
  at: number;
  /** configVersion() after the change. */
  version: string;
}

interface WatchState {
  emitter: EventEmitter;
  watcher?: fs.FSWatcher;
  poll?: NodeJS.Timeout;
  mtimes: Map<string, number>;
  pending: Map<string, NodeJS.Timeout>;
  discoveredHash?: string;
}

// Route handlers can be bundled separately (and re-evaluated in dev), so the state lives on globalThis.
const g = globalThis as typeof globalThis & { __pageConfigWatch?: WatchState };
const state: WatchState = (g.__pageConfigWatch ??= { emitter: new EventEmitter().setMaxListeners(0), mtimes: new Map(), pending: new Map() });

const DEBOUNCE_MS = 250;
const POLL_MS = 5000;

function yamlMtimes(): Map<string, number> {
  const out = new Map<string, number>();
  try {
    for (const name of fs.readdirSync(CONFIG_DIR)) {
      if (!name.endsWith(".yaml")) continue;
      try {
        out.set(name, fs.statSync(path.join(CONFIG_DIR, name)).mtimeMs);
      } catch {}
    }
  } catch {}
  return out;
}

/**
 * Identifies the current state of the config files (their names and mtimes). Pages render with it,
 * and the event stream sends it on connect, so a change made before the stream connected isn't missed.
 */
export function configVersion(): string {
  let h = 0;
  for (const [name, mtime] of [...yamlMtimes()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const ch of `${name}:${mtime};`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Tell subscribers that a config file changed (debounced per file: editors write in several steps). */
export function notifyChange(file: string) {
  clearTimeout(state.pending.get(file));
  state.pending.set(
    file,
    setTimeout(() => {
      state.pending.delete(file);
      invalidate();
      state.emitter.emit("change", { file, at: Date.now(), version: configVersion() } satisfies ConfigChange);
    }, DEBOUNCE_MS),
  );
}

function onFsEvent(name: string | null) {
  if (!name?.endsWith(".yaml")) return;
  state.mtimes = yamlMtimes();
  notifyChange(name.replace(/\.yaml$/, ""));
}

/** Compare mtimes: fs.watch misses changes on some bind mounts and network shares. */
function pollMtimes() {
  const now = yamlMtimes();
  for (const [name, mtime] of now) if (state.mtimes.get(name) !== mtime) notifyChange(name.replace(/\.yaml$/, ""));
  for (const name of state.mtimes.keys()) if (!now.has(name)) notifyChange(name.replace(/\.yaml$/, ""));
  state.mtimes = now;
}

function start() {
  if (state.poll) return;
  state.mtimes = yamlMtimes();
  try {
    state.watcher = fs.watch(CONFIG_DIR, (_event, name) => onFsEvent(name?.toString() ?? null));
    state.watcher.on("error", () => {
      state.watcher?.close();
      state.watcher = undefined;
    });
  } catch {
    // directory missing or watching unsupported: polling still works
  }
  state.poll = setInterval(pollMtimes, POLL_MS);
  state.poll.unref?.();
}

function stop() {
  state.watcher?.close();
  state.watcher = undefined;
  clearInterval(state.poll);
  state.poll = undefined;
}

/** Subscribe to config changes. Watching starts with the first subscriber and stops with the last. */
export function onConfigChange(fn: (c: ConfigChange) => void): () => void {
  state.emitter.on("change", fn);
  start();
  return () => {
    state.emitter.off("change", fn);
    if (state.emitter.listenerCount("change") === 0) stop();
  };
}

/** Docker discovery is not a file: report it as a services change when the discovered set differs. */
export function noteDiscovered(hash: string) {
  if (state.discoveredHash !== undefined && state.discoveredHash !== hash) notifyChange("services");
  state.discoveredHash = hash;
}
