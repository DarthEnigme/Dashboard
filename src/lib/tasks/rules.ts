import { repeatFinished } from "./recur";
import { all, fail, one, run, type TaskRow } from "./sql";

/**
 * The rules of finishing: a task is finished while it sits in a "done" column, and a task still
 * waiting for an open one can't be finished. Reads and writes both lean on these.
 */

const WAITING = "Finish the tasks this one waits for first";

/** Whether `id` waits for a task that is still open (only those in `ids`, when given). */
function waitsOnOpen(id: number, ids?: readonly number[]) {
  const rows = all<{ id: number }>("SELECT b.id FROM task_deps d JOIN tasks b ON b.id = d.blocked_by WHERE d.task_id = ? AND b.completed_at IS NULL", id);
  return rows.some((r) => !ids || ids.includes(r.id));
}

/**
 * The one way a task enters a column: finished in a "done" column (keeping the first time), open
 * again anywhere else. A repeating task that gets finished makes its next one.
 */
export function enterColumn(task: Pick<TaskRow, "id" | "completed_at">, column: { id: number; done: number }) {
  if (column.done && waitsOnOpen(task.id)) fail(WAITING);
  run("UPDATE tasks SET column_id = ?, completed_at = ? WHERE id = ?", column.id, column.done ? (task.completed_at ?? Date.now()) : null, task.id);
  if (column.done && task.completed_at === null) repeatFinished([task.id]);
}

/** A finished task can't start waiting for an open one: checked on the blockers it just gained. */
export function checkNewBlockers(task: { id: number }, column: { done: number }, added: readonly number[]) {
  if (column.done && added.length && waitsOnOpen(task.id, added)) fail(WAITING);
}

/**
 * A column becomes "done" (its tasks finished, all at once) or not (its tasks open again). Tasks in it
 * waiting on each other finish together; one waiting on an open task elsewhere blocks the change.
 */
export function setColumnDone(columnId: number, done: boolean) {
  if (done) {
    const stuck = one(
      `SELECT 1 FROM tasks t JOIN task_deps d ON d.task_id = t.id JOIN tasks b ON b.id = d.blocked_by
       WHERE t.column_id = ? AND b.completed_at IS NULL AND b.column_id != ? LIMIT 1`,
      columnId,
      columnId,
    );
    if (stuck) fail(WAITING);
    const finishing = all<{ id: number }>("SELECT id FROM tasks WHERE column_id = ? AND completed_at IS NULL", columnId).map((r) => r.id);
    run("UPDATE tasks SET completed_at = COALESCE(completed_at, ?) WHERE column_id = ?", Date.now(), columnId);
    run("UPDATE task_columns SET done = 1 WHERE id = ?", columnId);
    repeatFinished(finishing);
    return;
  }
  run("UPDATE tasks SET completed_at = NULL WHERE column_id = ?", columnId);
  run("UPDATE task_columns SET done = 0 WHERE id = ?", columnId);
}

/** Every "waits for" link of a board, as task → the tasks it waits for. */
export function boardWaits(boardId: number): Map<number, number[]> {
  const rows = all<{ task_id: number; blocked_by: number }>(
    "SELECT d.task_id, d.blocked_by FROM task_deps d JOIN tasks t ON t.id = d.task_id JOIN task_columns c ON c.id = t.column_id WHERE c.board_id = ?",
    boardId,
  );
  const out = new Map<number, number[]>();
  for (const r of rows) out.set(r.task_id, [...(out.get(r.task_id) ?? []), r.blocked_by]);
  return out;
}
