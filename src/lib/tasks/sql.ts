import { db } from "../db";

/** What every part of the task store shares: query helpers, ownership checks and ordering. */
type Arg = string | number | null;

export const fail = (message: string): never => {
  throw new Error(message);
};
export const run = (sql: string, ...args: Arg[]) => db().prepare(sql).run(...args);
export const one = <T>(sql: string, ...args: Arg[]) => db().prepare(sql).get(...args) as T | undefined;
export const all = <T>(sql: string, ...args: Arg[]) => db().prepare(sql).all(...args) as unknown as T[];

// ---------- ownership: each returns the row with its board, or throws ----------

export const ownBoard = (userId: number, id: number) => one<{ id: number }>("SELECT id FROM task_boards WHERE id = ? AND owner_id = ?", id, userId)?.id ?? fail("No such board");

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

/**
 * Put `id` at `index` among its siblings (the rows of `table` matching every `scope` column, nulls
 * included) and renumber them. An index past the end, or null, means last.
 */
export function place(table: "tasks" | "task_columns" | "task_lanes", scope: Record<string, number | null>, id: number, index: number | null) {
  const keys = Object.keys(scope);
  const where = keys.map((k) => `${k} IS ?`).join(" AND ");
  const ids = all<{ id: number }>(`SELECT id FROM ${table} WHERE ${where} AND id != ? ORDER BY ord, id`, ...keys.map((k) => scope[k]), id).map((r) => r.id);
  ids.splice(index === null ? ids.length : Math.min(index, ids.length), 0, id);
  ids.forEach((sibling, ord) => run(`UPDATE ${table} SET ord = ? WHERE id = ?`, ord, sibling));
}

/** The next free position at the end of a scope. */
export const lastOrd = (table: "tasks" | "task_columns" | "task_lanes", scope: Record<string, number | null>) => {
  const keys = Object.keys(scope);
  return one<{ n: number }>(`SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM ${table} WHERE ${keys.map((k) => `${k} IS ?`).join(" AND ")}`, ...keys.map((k) => scope[k]))!.n;
};
