import fs from "node:fs";
import path from "node:path";

/** Where the database, snapshots and uploads live. Its own module so snapshots.ts can use it without importing db.ts. */
export const DATA_DIR = process.env.HOMEPAGE_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data");

/** Make renames and deletions in `dir` survive a power cut (best effort: not every system can sync a folder). */
export function syncDir(dir: string) {
  try {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Windows can't open a folder for syncing; its renames are durable enough for a dev machine.
  }
}
