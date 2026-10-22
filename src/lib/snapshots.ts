import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, syncDir } from "./data-dir";
import { readJournal } from "./update/journal";

// Safety copies of the database taken before migrations and updates (raw SQLite files), and the
// file swap that puts one back. Every step writes to a side file first and renames it into place,
// so a crash or power cut never leaves a half-written file under a name that counts.

export const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
export const KEEP_SNAPSHOTS = 5;
/** pre-update-0.6.0-to-0.6.1-2026-10-19T17-00-56-516Z.db: one file name, no path. */
const SNAPSHOT_NAME = /^[\w-][\w.-]*\.db$/;

/** Copy the database to `out` with VACUUM INTO (consistent while NanoDash runs), through `out.tmp`. */
export function vacuumInto(d: DatabaseSync, out: string) {
  const tmp = `${out}.tmp`;
  fs.rmSync(tmp, { force: true });
  try {
    d.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    fs.renameSync(tmp, out);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Take a snapshot of `d` and drop the oldest beyond KEEP_SNAPSHOTS; returns the file. The one an update
 * in progress would put back is never dropped, however many restarts take a snapshot meanwhile.
 */
export function snapshotDb(label: string, d: DatabaseSync): string {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const out = path.join(SNAPSHOT_DIR, `${label.replace(/[^\w.-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  vacuumInto(d, out);
  const pinned = readJournal()?.snapshot;
  const old = listSnapshots().filter((s) => !pinned || s.name !== path.basename(pinned));
  for (const { name } of old.slice(KEEP_SNAPSHOTS)) fs.rmSync(path.join(SNAPSHOT_DIR, name), { force: true });
  return out;
}

/** Snapshots on disk, newest first. */
export function listSnapshots(): { name: string; size: number; at: number }[] {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  return fs
    .readdirSync(SNAPSHOT_DIR)
    .filter((name) => SNAPSHOT_NAME.test(name))
    .map((name) => {
      const st = fs.statSync(path.join(SNAPSHOT_DIR, name));
      return { name, size: st.size, at: st.mtimeMs };
    })
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

/** The file for a snapshot name, or undefined when the name isn't one (no path tricks). */
export function snapshotPath(name: string): string | undefined {
  if (!SNAPSHOT_NAME.test(name)) return undefined;
  const p = path.join(SNAPSHOT_DIR, name);
  return fs.existsSync(p) ? p : undefined;
}

/** True when `file` opens as an SQLite database and passes a quick integrity check. */
function isSound(file: string): boolean {
  try {
    const d = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = d.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
      return rows.length === 1 && rows[0].quick_check === "ok";
    } finally {
      d.close();
    }
  } catch {
    return false;
  }
}

/**
 * Put `snapshot` in place of the (closed) database `file`, moving the current one and its -wal/-shm
 * to `kept`. The copy is written and synced as `file.restoring` before anything is moved, and the main
 * file moves last: if this stops halfway, finishRestore completes it on the next start.
 */
export function restoreSnapshot(snapshot: string, file: string, kept: string) {
  if (!isSound(snapshot)) throw new Error(`The snapshot ${snapshot} is damaged; nothing was restored.`);
  const restoring = `${file}.restoring`;
  fs.copyFileSync(snapshot, restoring);
  const fd = fs.openSync(restoring, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (const ext of ["-wal", "-shm", ""]) if (fs.existsSync(file + ext)) fs.renameSync(file + ext, kept + ext);
  fs.renameSync(restoring, file);
  syncDir(path.dirname(file));
}

/** On start, before opening `file`: complete a restore that stopped between moving the old file out and the copy in. */
export function finishRestore(file: string) {
  const restoring = `${file}.restoring`;
  if (!fs.existsSync(restoring)) return;
  // The database is still there: the restore stopped before moving anything, and it is decided again from it.
  if (fs.existsSync(file)) fs.rmSync(restoring, { force: true });
  else fs.renameSync(restoring, file);
}
