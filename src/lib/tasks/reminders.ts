import { getAppMeta, setAppMeta } from "../db";
import { hasAlertChannel, sendNotice } from "../alerts";
import { loadConfig } from "../config/load";
import { localDay } from "../day";
import { taskHref } from "./links";
import { dueLimit, dueToRemind } from "./read";
import type { DueTask } from "./types";

const when = (left: number) => (left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`);

/** What the alert channels hear about a task: once when it gets close, once more when it is late. */
function notice(t: DueTask, today: string) {
  const left = Math.round((Date.parse(t.due) - Date.parse(today)) / 86_400_000);
  return t.overdue
    ? { key: `task-overdue:${t.id}:${t.due}`, level: "warn" as const, message: `The task “${t.title}” (${t.board}) is overdue: it was due ${t.due}.` }
    : { key: `task-due:${t.id}:${t.due}`, level: "info" as const, message: `The task “${t.title}” (${t.board}) is due ${when(left)} (${t.due}).` };
}

/** Hourly: tell the alert channels about due and overdue tasks, for the boards that asked for it. */
export async function taskReminderJob(now = new Date()) {
  const { settings } = loadConfig();
  if (!hasAlertChannel(settings.alerts)) return;
  const today = localDay(now);
  for (const t of dueToRemind(dueLimit(now, settings.tasks.dueSoonDays), today)) {
    const n = notice(t, today);
    if (getAppMeta(n.key)) continue;
    const errors = await sendNotice(settings.alerts, { kind: "task", level: n.level, message: n.message, url: taskHref(t), task: t.title, board: t.board, due: t.due });
    if (!errors.length) setAppMeta(n.key, true);
  }
}
