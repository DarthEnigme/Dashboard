import { transaction } from "../db";
import { int, text } from "../clean";
import { enterColumn } from "./items";
import type { PartInput } from "./types";
import { all, fail, lastOrd, one, ownBoard, ownColumn, place, run } from "./sql";

const MAX_COLUMNS = 12;

/** { board, name } */
export function addColumn(userId: number, b: PartInput): number {
  const board = ownBoard(userId, Number(b.board));
  const name = text(b.name, 60) ?? fail("Name required");
  if (one<{ n: number }>("SELECT COUNT(*) AS n FROM task_columns WHERE board_id = ?", board)!.n >= MAX_COLUMNS) fail(`A board can have up to ${MAX_COLUMNS} columns`);
  run("INSERT INTO task_columns (board_id, name, ord, done) VALUES (?, ?, ?, 0)", board, name, lastOrd("task_columns", { board_id: board }));
  return board;
}

/** { id, name?, done?, index? }: rename, mark as the "done" kind, or move among the board's columns. */
export function updateColumn(userId: number, b: PartInput): number {
  const column = ownColumn(userId, Number(b.id));
  transaction(() => {
    if (b.name !== undefined) run("UPDATE task_columns SET name = ? WHERE id = ?", text(b.name, 60) ?? fail("Name required"), column.id);
    if (typeof b.done === "boolean" && b.done !== (column.done === 1)) {
      const now = { ...column, done: b.done ? 1 : 0 };
      run("UPDATE task_columns SET done = ? WHERE id = ?", now.done, column.id);
      // Its tasks become finished, or open again, with the column: by the same rule as a move.
      for (const task of all<{ id: number; completed_at: number | null }>("SELECT id, completed_at FROM tasks WHERE column_id = ?", column.id)) enterColumn(task, now);
    }
    if (b.index !== undefined) place("task_columns", { board_id: column.board_id }, column.id, int(b.index, 0, MAX_COLUMNS) ?? fail("Bad position"));
  });
  return column.board_id;
}

/** Only an empty column goes: its tasks are moved or deleted first, so none vanish with it. */
export function deleteColumn(userId: number, id: number): number {
  const column = ownColumn(userId, id);
  if (one("SELECT 1 FROM tasks WHERE column_id = ? LIMIT 1", column.id)) fail("Move or delete this column's tasks first");
  run("DELETE FROM task_columns WHERE id = ?", column.id);
  return column.board_id;
}
