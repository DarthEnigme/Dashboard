import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, syncDir } from "../data-dir";

// The record of an update in progress, in a file next to the database rather than in it: the new
// version migrates the database and a rollback replaces it, and the record has to outlive both.
// The old version writes it before the handover; whichever version starts next reads it (db.ts to put
// the database back, apply.ts to record the outcome) and clears it once the outcome is certain.
// Its shape is read by every later release rolling back onto this one: only ever add fields.

export const JOURNAL_FILE = path.join(DATA_DIR, "update.json");
/** Where 0.6.0 kept the record (an app_meta row): still read, so an update 0.6.0 started is recorded. */
export const LEGACY_PENDING = "update.pending";

export interface Journal {
  from: string;
  fromBuild: string;
  to: string;
  image: string;
  user: string | null;
  startedAt: number;
  /** The process that handed over: a later process of the same build means the helper rolled back. */
  bootId?: string;
  /** Database copy taken just before the handover: put back if the helper rolls back (see db.ts). */
  snapshot?: string;
  /** Set when a rollback put that copy back: what was saved in the newer version is only in `kept`. */
  restored?: RestoredDb;
}

export interface RestoredDb {
  snapshot: string;
  kept: string;
  at: string;
}

export function readJournal(): Journal | undefined {
  try {
    return JSON.parse(fs.readFileSync(JOURNAL_FILE, "utf8")) as Journal;
  } catch {
    return undefined;
  }
}

/** Written through a synced side file and renamed into place: a power cut leaves the old record or the new one. */
export function writeJournal(j: Journal) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${JOURNAL_FILE}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(j, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, JOURNAL_FILE);
  syncDir(DATA_DIR);
}

export function clearJournal() {
  fs.rmSync(JOURNAL_FILE, { force: true });
  syncDir(DATA_DIR);
}
