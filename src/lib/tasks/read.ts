import { parseTags } from "../clean";
import { localDay } from "../day";
import { ensureBoards } from "./boards";
import { boardWaits } from "./items";
import { all, one } from "./sql";
import type { BoardNames, DueTask, Task, TasksData, TasksSummary } from "./types";

/**
 * The board `boardId` (or this person's first one) with its lanes, columns and tasks. Someone with no
 * board yet gets one, with the three usual columns named by `names` (the caller's language).
 */
export function loadBoard(userId: number, boardId: number | undefined, names: BoardNames): Omit<TasksData, "alerts"> {
  const boards = ensureBoards(userId, names);
  const summary = boards.find((b) => b.id === boardId) ?? boards[0];
  const flags = one<{ project: number; notify: number }>("SELECT project, notify FROM task_boards WHERE id = ?", summary.id)!;
  const lanes = all<{ id: number; name: string; collapsed: number }>("SELECT id, name, collapsed FROM task_lanes WHERE board_id = ? ORDER BY ord, id", summary.id);
  const columns = all<{ id: number; name: string; done: number }>("SELECT id, name, done FROM task_columns WHERE board_id = ? ORDER BY ord, id", summary.id);
  const rows = all<Omit<Task, "labels" | "blocked_by" | "blocked"> & { labels: string | null }>(
    `SELECT t.id, t.column_id, t.lane_id, t.title, t.body, t.priority, t.due, t.labels, t.created_at, t.completed_at
     FROM tasks t JOIN task_columns c ON c.id = t.column_id WHERE c.board_id = ? ORDER BY t.ord, t.id`,
    summary.id,
  );
  const waits = boardWaits(summary.id);
  const open = new Set(rows.filter((r) => r.completed_at === null).map((r) => r.id));
  const tasks: Task[] = rows.map((r) => {
    const blocked_by = waits.get(r.id) ?? [];
    return { ...r, labels: parseTags(r.labels), blocked_by, blocked: open.has(r.id) && blocked_by.some((b) => open.has(b)) };
  });
  const labels = [...new Map(tasks.flatMap((t) => t.labels).map((l) => [l.toLowerCase(), l])).values()].sort((a, b) => a.localeCompare(b));
  return {
    boards,
    board: {
      ...summary,
      project: flags.project === 1,
      notify: flags.notify === 1,
      lanes: lanes.map((l) => ({ id: l.id, name: l.name, collapsed: l.collapsed === 1 })),
      columns: columns.map((c) => ({ id: c.id, name: c.name, done: c.done === 1, tasks: tasks.filter((t) => t.column_id === c.id) })),
    },
    labels,
  };
}

const DAY = 86_400_000;

/** The last day that still counts as "due soon", `days` after today. */
export const dueLimit = (now: Date, days: number) => localDay(new Date(now.getTime() + days * DAY));

/** Open tasks due by `limit` (overdue ones included) on the boards matching `where`, soonest first. */
function openDue(where: string, args: number[], limit: string, today: string): DueTask[] {
  return all<Omit<DueTask, "overdue">>(
    `SELECT t.id, t.title, t.due, b.id AS board_id, b.name AS board FROM tasks t
     JOIN task_columns c ON c.id = t.column_id JOIN task_boards b ON b.id = c.board_id
     WHERE ${where} AND t.completed_at IS NULL AND t.due IS NOT NULL AND t.due <= ? ORDER BY t.due, t.id`,
    ...args,
    limit,
  ).map((t) => ({ ...t, overdue: t.due < today }));
}

/** A person's open tasks due by `limit`. */
export const dueFor = (userId: number, limit: string, today: string) => openDue("b.owner_id = ?", [userId], limit, today);

/** The open tasks due by `limit` on every board that sends reminders. */
export const dueToRemind = (limit: string, today: string) => openDue("b.notify = 1", [], limit, today);

/** Open and overdue counts, and the tasks that are overdue or due within `days`. */
export function tasksSummary(userId: number, days: number, now = new Date(), max = 8): TasksSummary {
  const today = localDay(now);
  const due = dueFor(userId, dueLimit(now, days), today);
  const { open } = one<{ open: number }>(
    "SELECT COUNT(*) AS open FROM tasks t JOIN task_columns c ON c.id = t.column_id JOIN task_boards b ON b.id = c.board_id WHERE b.owner_id = ? AND t.completed_at IS NULL",
    userId,
  )!;
  return { open, overdue: due.filter((t) => t.overdue).length, due: due.slice(0, max) };
}
