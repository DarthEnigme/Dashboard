import { loadConfig } from "../config/load";
import { getAppMeta, setAppMeta } from "../db";
import { hasAlertChannel, sendNotice } from "../alerts";
import { CHECK_EVERY_MS, refreshStatus, savedStatus } from "./check";
import { applyUpdate, ImageMissingError, preflight } from "./apply";

/** The hourly job runs once per hour, so "in the window" means the window's hour. */
export function inWindow(window: string, now: Date): boolean {
  return now.getHours() === Number.parseInt(window.slice(0, 2), 10);
}

/** Hourly: check every 6 hours, tell the alert channels once per new version, and auto-install if enabled. */
export async function updateJob(now = new Date()) {
  const { settings } = loadConfig();
  const cfg = settings.updates;
  if (!cfg.check) return;
  let status = savedStatus(cfg);
  if (!status.checkedAt || now.getTime() - Date.parse(status.checkedAt) > CHECK_EVERY_MS - 300_000) status = await refreshStatus(cfg);
  if (!status.available || !status.latest) return;
  const version = status.latest.version;

  if (cfg.notify && hasAlertChannel(settings.alerts) && getAppMeta<string>("update.notified") !== version) {
    const errors = await sendNotice(settings.alerts, {
      kind: "update",
      level: "info",
      message: `Page ${version} is available (running ${status.current.version}).${cfg.auto ? ` It will be installed at ${cfg.window}.` : ""}`,
      url: status.latest.url,
      version,
      current: status.current.version,
    });
    if (!errors.length) setAppMeta("update.notified", version);
  }

  // One automatic attempt per version: a failed one waits for an admin. An image that isn't
  // published yet doesn't count: the next window tries again.
  if (cfg.auto && inWindow(cfg.window, now) && getAppMeta<string>("update.autoTried") !== version) {
    if (!(await preflight(cfg)).canApply) return;
    setAppMeta("update.autoTried", version);
    try {
      await applyUpdate(cfg, status, "auto-update");
    } catch (e) {
      if (!(e instanceof ImageMissingError)) throw e;
      setAppMeta("update.autoTried", undefined);
    }
  }
}
