import { fail } from "../clean";
import { all, one, owned, run } from "../sql";

/** What every part of the task store shares: the query helpers, ownership checks and ordering. */
export { fail };
export { all, bool, flag, one, patch, run } from "../sql";

// ---------- ownership: each returns the row with its board, or throws ----------

export const ownBoard = (userId: number, id: number) => owned("task_boards", userId, id, "No such board");

export interface ColumnRow {
  id: number;
  board_id: number;
  done: number;
}
export const ownColumn = (userId: number, id: number) =>
  one<ColumnRow>("SELECT c.id, c.board_id, c.done FROM task_columns c JOIN task_boards b ON b.id = c.board_id WHERE c.id = ? AND b.owner_id = ?", id, userId) ?? fail("No such column");

export const ownLane = (userId: number, id: number) =>
  one<{ id: number; board_id: number }>("SELECT l.id, l.board_id FROM task_lanes l JOIN task_boards b ON b.id = l.board_id WHERE l.id = ? AND b.owner_id = ?", id, userId) ?? fail("No such lane");

export interface TaskRow {
  id: number;
  column_id: number;
  lane_id: number | null;
  board_id: number;
  /** Whether its column is a "done" one. */
  column_done: number;
  completed_at: number | null;
}
export const ownTask = (userId: number, id: number) =>
  one<TaskRow>(
    `SELECT t.id, t.column_id, t.lane_id, c.board_id, c.done AS column_done, t.completed_at FROM tasks t JOIN task_columns c ON c.id = t.column_id JOIN task_boards b ON b.id = c.board_id
     WHERE t.id = ? AND b.owner_id = ?`,
    id,
    userId,
  ) ?? fail("No such task");

// ---------- ordering ----------

type Ordered = "tasks" | "task_columns" | "task_lanes";
type Scope = Record<string, number | null>;

/** The rows matching every `scope` column, nulls included. */
const scopeWhere = (scope: Scope) => ({ sql: Object.keys(scope).map((k) => `${k} IS ?`).join(" AND "), args: Object.values(scope) });

/**
 * Put `id` at `index` among its siblings (the rows of `table` in `scope`) and renumber them. An index
 * past the end, or null, means last.
 */
export function place(table: Ordered, scope: Scope, id: number, index: number | null) {
  const w = scopeWhere(scope);
  const ids = all<{ id: number }>(`SELECT id FROM ${table} WHERE ${w.sql} AND id != ? ORDER BY ord, id`, ...w.args, id).map((r) => r.id);
  ids.splice(index === null ? ids.length : Math.min(index, ids.length), 0, id);
  ids.forEach((sibling, ord) => run(`UPDATE ${table} SET ord = ? WHERE id = ?`, ord, sibling));
}

/** The next free position at the end of a scope. */
export const lastOrd = (table: Ordered, scope: Scope) => {
  const w = scopeWhere(scope);
  return one<{ n: number }>(`SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM ${table} WHERE ${w.sql}`, ...w.args)!.n;
};
