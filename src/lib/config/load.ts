import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { configFiles, type ConfigFile, type Settings, type ServiceGroup, type BookmarkGroup, type InfoWidget } from "./schema";
import { defaultFiles } from "./defaults";
import { substituteEnv } from "./env";

export const CONFIG_DIR = process.env.HOMEPAGE_CONFIG_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "config");

export const filePath = (file: ConfigFile) => path.join(CONFIG_DIR, `${file}.yaml`);

export interface LoadedConfig {
  settings: Settings;
  services: ServiceGroup[];
  bookmarks: BookmarkGroup[];
  widgets: InfoWidget[];
  errors: string[];
}

let ensured = false;
function ensureDefaults() {
  if (ensured) return;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  for (const [name, content] of Object.entries(defaultFiles)) {
    // The config folder is chosen at run time: nothing for the bundler to trace from here.
    const p = path.join(/* turbopackIgnore: true */ CONFIG_DIR, name);
    if (!fs.existsSync(/* turbopackIgnore: true */ p)) fs.writeFileSync(p, content, "utf8");
  }
  ensured = true;
}

/** Raw parsed YAML (no env substitution, no validation). */
export function readRaw(file: ConfigFile): unknown {
  ensureDefaults();
  const text = fs.readFileSync(filePath(file), "utf8");
  return YAML.parse(text) ?? undefined;
}

const cache = new Map<ConfigFile, { mtime: number; value: unknown; error?: string }>();

/** The last version of each file that passed validation (kept across invalidate()). */
const lastValid = new Map<ConfigFile, unknown>();

/**
 * What an invalid file runs on: its last valid version, so a typo in a hand edit changes nothing.
 * With none seen since start, the defaults, but signed-in only: the broken settings.yaml may be the
 * one that turned the public view off.
 */
function fallback(file: ConfigFile): { value: unknown; note: string } {
  const kept = lastValid.get(file);
  if (kept !== undefined) return { value: kept, note: " (still using the last valid version)" };
  const value = configFiles[file].parse(undefined);
  if (file !== "settings") return { value, note: " (using the defaults)" };
  const s = value as Settings;
  return { value: { ...s, auth: { ...s.auth, publicView: false } }, note: " (using the defaults, sign-in required)" };
}

function loadFile(file: ConfigFile): { value: unknown; error?: string } {
  ensureDefaults();
  const p = filePath(file);
  let mtime = 0;
  try {
    mtime = fs.statSync(p).mtimeMs;
  } catch {
    // missing file -> schema default
  }
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit;

  const schema = configFiles[file];
  let entry: { mtime: number; value: unknown; error?: string };
  try {
    const raw = mtime ? readRaw(file) : undefined;
    const parsed = schema.safeParse(substituteEnv(raw));
    if (parsed.success) {
      entry = { mtime, value: parsed.data };
      lastValid.set(file, parsed.data);
    } else {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      const { value, note } = fallback(file);
      entry = { mtime, value, error: `${file}.yaml: ${issues}${note}` };
    }
  } catch (e) {
    const { value, note } = fallback(file);
    entry = { mtime, value, error: `${file}.yaml: ${(e as Error).message}${note}` };
  }
  cache.set(file, entry);
  return entry;
}

/** Fully resolved config (env substituted, validated). Re-reads a file only when its mtime changes. */
export function loadConfig(): LoadedConfig {
  const s = loadFile("settings");
  const sv = loadFile("services");
  const b = loadFile("bookmarks");
  const w = loadFile("widgets");
  return {
    settings: s.value as Settings,
    services: sv.value as ServiceGroup[],
    bookmarks: b.value as BookmarkGroup[],
    widgets: w.value as InfoWidget[],
    errors: [s.error, sv.error, b.error, w.error].filter((e): e is string => !!e),
  };
}

export function invalidate() {
  cache.clear();
}
