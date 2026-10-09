import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR, loadConfig } from "./config/load";
import { configFiles, type Settings } from "./config/schema";
import { DATA_DIR, db, getAppMeta, setAppMeta } from "./db";
import { hasAlertChannel, sendNotice } from "./alerts";
import { zip } from "./zip";

/** page-backup-2026-10-09-0300.zip */
const NAME = /^page-backup-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.zip$/;
export const isBackupName = (name: string) => NAME.test(name);

export interface BackupInfo {
  name: string;
  size: number;
  /** ms since epoch */
  at: number;
}

export interface BackupStatus {
  at: string;
  ok: boolean;
  name?: string;
  size?: number;
  error?: string;
  by: string;
}

export const backupDir = (cfg: Settings["backup"] = loadConfig().settings.backup) => (cfg.dir ? path.resolve(cfg.dir) : path.join(DATA_DIR, "backups"));

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

/** Every file under `dir`, as paths relative to it (for data/uploads). */
function walk(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : e.isFile() ? [path.relative(base, p).split(path.sep).join("/")] : [];
  });
}

/**
 * One zip with everything needed to rebuild this Page: the config files, a consistent copy of
 * the database (taken with VACUUM INTO, safe while Page runs), uploads, and the secret key that
 * signs sessions and encrypts two-factor secrets.
 */
export function createBackup(by: string, now = new Date()): BackupInfo {
  const cfg = loadConfig().settings.backup;
  const dir = backupDir(cfg);
  fs.mkdirSync(dir, { recursive: true });
  let name = `page-backup-${stamp(now)}.zip`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `page-backup-${stamp(now)}-${n}.zip`;

  const snapshot = path.join(dir, `.snapshot-${process.pid}-${now.getTime()}.db`);
  try {
    db().exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    const files: { name: string; data: Uint8Array }[] = [];
    for (const f of Object.keys(configFiles)) {
      const p = path.join(CONFIG_DIR, `${f}.yaml`);
      if (fs.existsSync(p)) files.push({ name: `config/${f}.yaml`, data: fs.readFileSync(p) });
    }
    files.push({ name: "data/page.db", data: fs.readFileSync(snapshot) });
    const key = path.join(DATA_DIR, "secret.key");
    if (fs.existsSync(key)) files.push({ name: "data/secret.key", data: fs.readFileSync(key) });
    for (const rel of walk(path.join(DATA_DIR, "uploads"))) files.push({ name: `data/uploads/${rel}`, data: fs.readFileSync(path.join(DATA_DIR, "uploads", rel)) });
    files.push({
      name: "README.txt",
      data: Buffer.from(
        `Page backup taken ${now.toISOString()} (by ${by}).\n\nTo restore: stop Page, copy config/ over your config folder and data/ over your data folder\n(delete page.db-wal and page.db-shm there first), then start Page again.\n`,
      ),
    });
    const out = path.join(dir, name);
    // Write then rename, so a half-written zip never looks like a backup.
    fs.writeFileSync(`${out}.part`, zip(files, now));
    fs.renameSync(`${out}.part`, out);
    prune(dir, cfg.keep);
    return { name, size: fs.statSync(out).size, at: now.getTime() };
  } finally {
    fs.rmSync(snapshot, { force: true });
  }
}

/** Backups in the folder, newest first. */
export function listBackups(dir = backupDir()): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(isBackupName)
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, at: st.mtimeMs };
    })
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

/** Keep the newest `keep` backups. */
export function prune(dir: string, keep: number) {
  for (const b of listBackups(dir).slice(keep)) fs.rmSync(path.join(dir, b.name), { force: true });
}

/** The file for a backup name, or undefined when the name isn't one of ours (no path tricks). */
export function backupPath(name: string): string | undefined {
  if (!isBackupName(name)) return undefined;
  const p = path.join(backupDir(), name);
  return fs.existsSync(p) ? p : undefined;
}

export const backupStatus = () => getAppMeta<BackupStatus>("backup.last");

/** Back up now and remember the outcome (shown in Settings); failures go to the alert channels. */
export async function runBackup(by: string, now = new Date()): Promise<BackupStatus> {
  let status: BackupStatus;
  try {
    const b = createBackup(by, now);
    status = { at: now.toISOString(), ok: true, name: b.name, size: b.size, by };
  } catch (e) {
    status = { at: now.toISOString(), ok: false, error: (e as Error).message, by };
    console.error("[page] backup failed:", e);
    const { alerts } = loadConfig().settings;
    if (hasAlertChannel(alerts)) await sendNotice(alerts, { kind: "backup", level: "error", message: `Backup failed: ${status.error}`, error: status.error });
  }
  setAppMeta("backup.last", status);
  return status;
}

/** Hourly: once a day, in the configured hour. */
export async function backupJob(now = new Date()) {
  const cfg = loadConfig().settings.backup;
  if (!cfg.enabled) return;
  if (now.getHours() !== Number.parseInt(cfg.time.slice(0, 2), 10)) return;
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (getAppMeta<string>("backup.day") === today) return;
  setAppMeta("backup.day", today);
  await runBackup("nightly", now);
}
