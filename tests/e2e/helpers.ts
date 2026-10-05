import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

export const CONFIG_DIR = path.join(__dirname, ".config");
export const SHOTS_DIR = path.join(__dirname, "..", "..", "test-results", "shots");

/** Full-page screenshot for manual review (test-results/shots/<name>.png). */
export async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  // Let fonts, icons and entrance animations settle. The live-reload event stream never closes,
  // so the network never goes fully idle: don't wait for it for long.
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: opts.fullPage ?? true });
}

export const readConfig = (file: string) => fs.readFileSync(path.join(CONFIG_DIR, `${file}.yaml`), "utf8");

/** Rewrite a config file; the server picks it up on the next request (mtime check). */
export function writeConfig(file: string, text: string) {
  const p = path.join(CONFIG_DIR, `${file}.yaml`);
  fs.writeFileSync(p, text);
  // Ensure the mtime changes even within the same millisecond tick.
  const t = new Date(Date.now() + 1000);
  fs.utimesSync(p, t, t);
}

/** Patch top-level `key: value` lines in settings.yaml (adds the key when missing). */
export function setSetting(key: string, value: string) {
  const text = readConfig("settings");
  const re = new RegExp(`^${key}:.*$`, "m");
  writeConfig("settings", re.test(text) ? text.replace(re, `${key}: ${value}`) : `${text.trimEnd()}\n${key}: ${value}\n`);
}
