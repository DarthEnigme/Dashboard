import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config/load";
import { APPS, type App } from "./config/schema";
import { db, getAppMeta, setAppMeta, transaction } from "./db";
import { backupDir, stamp } from "./backup";
import { audit } from "./auth/users";
import { hasData, MODULE_TABLES } from "./modules";
import { zipToFile } from "./zip";

/**
 * An app turned off keeps its data for `backup.moduleRetentionDays`: turning it back on in time
 * loses nothing. Meanwhile a copy waits in the backup folder; at the deadline both are deleted.
 */
const KEY = "modules.off";
const DAY = 86_400_000;

interface OffEntry {
  /** When it was found turned off (ISO). */
  since: string;
  /** The archive's file name in the backup folder. */
  archive: string;
}
type OffState = Partial<Record<App, OffEntry>>;

export interface ModuleStatus {
  app: App;
  since: string;
  wipeAt: string;
  archive: string;
  /** Bytes; missing when the archive was deleted by hand. */
  size?: number;
}

const retentionDays = () => loadConfig().settings.backup.moduleRetentionDays;
const wipeAt = (e: OffEntry, days = retentionDays()) => new Date(Date.parse(e.since) + days * DAY);

/** One JSON file per table plus a README, in the backup folder. Returns the file name. */
export function archiveModule(app: App, now = new Date(), days = retentionDays()): string {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  let name = `page-module-${app}-${stamp(now)}.zip`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `page-module-${app}-${stamp(now)}-${n}.zip`;
  const files = MODULE_TABLES[app].map((t) => ({ name: `${t}.json`, data: JSON.stringify(db().prepare(`SELECT * FROM ${t}`).all(), null, 1) }));
  const deadline = new Date(now.getTime() + days * DAY);
  files.push({
    name: "README.txt",
    data: `NanoDash "${app}" was turned off on ${now.toISOString()}.\n\nIts data stays in NanoDash until ${deadline.toISOString()}: turn "${app}" back on in Settings before then and nothing is lost.\nAfter that it is deleted from the database, and this archive with it. Each <table>.json holds that table's rows.\n`,
  });
  const out = path.join(dir, name);
  // Write then rename, so a half-written zip never looks like an archive.
  zipToFile(`${out}.part`, files, now);
  fs.renameSync(`${out}.part`, out);
  return name;
}

function dropArchive(name: string) {
  fs.rmSync(path.join(backupDir(), name), { force: true });
}

/**
 * Bring the database in line with `settings.apps`, however it changed (Settings, undo, import or the
 * YAML by hand): archive apps newly turned off, forget apps turned back on, delete expired ones.
 */
export function reconcileModules(now = new Date()) {
  const { apps } = loadConfig().settings;
  const days = retentionDays();
  const state: OffState = { ...getAppMeta<OffState>(KEY) };
  for (const app of APPS) {
    const entry = state[app];
    if (apps.includes(app)) {
      if (!entry) continue;
      // Back on: the data was never touched, the archive is no longer needed.
      dropArchive(entry.archive);
      delete state[app];
    } else if (!entry) {
      if (hasData(app)) state[app] = { since: now.toISOString(), archive: archiveModule(app, now, days) };
    } else if (now >= wipeAt(entry, days)) {
      transaction(() => {
        for (const t of MODULE_TABLES[app]) db().exec(`DELETE FROM ${t}`);
      });
      dropArchive(entry.archive);
      delete state[app];
      audit("system", "module-wipe", { app });
    }
  }
  setAppMeta(KEY, Object.keys(state).length ? state : undefined);
}

/** Apps waiting to be deleted, for Settings. */
export function moduleStatus(): ModuleStatus[] {
  const state = getAppMeta<OffState>(KEY) ?? {};
  const days = retentionDays();
  return APPS.flatMap((app) => {
    const e = state[app];
    if (!e) return [];
    const file = path.join(backupDir(), e.archive);
    return [{ app, since: e.since, wipeAt: wipeAt(e, days).toISOString(), archive: e.archive, size: fs.existsSync(file) ? fs.statSync(file).size : undefined }];
  });
}
