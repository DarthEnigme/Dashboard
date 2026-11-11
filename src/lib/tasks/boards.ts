import { transaction } from "../db";
import { text } from "../clean";
import { all, fail, ownBoard, run } from "./sql";
import type { BoardInput, BoardNames, BoardSummary } from "./types";

const MAX_BOARDS = 50;

export const listBoards = (userId: number) => all<BoardSummary>("SELECT id, name FROM task_boards WHERE owner_id = ? ORDER BY created_at, id", userId);

/** { name }: a new board with the three usual columns, named by `names` (the last one is for finished tasks). */
export function createBoard(userId: number, b: BoardInput, names: BoardNames): number {
  const name = text(b.name, 80) ?? fail("Name required");
  if (listBoards(userId).length >= MAX_BOARDS) fail(`A person can have up to ${MAX_BOARDS} boards`);
  return transaction(() => {
    const id = Number(run("INSERT INTO task_boards (owner_id, name, created_at) VALUES (?, ?, ?)", userId, name, Date.now()).lastInsertRowid);
    names.columns.forEach((column, ord) => run("INSERT INTO task_columns (board_id, name, ord, done) VALUES (?, ?, ?, ?)", id, column, ord, ord === names.columns.length - 1 ? 1 : 0));
    return id;
  });
}

/** This person's boards, after giving them a first one if they have none. */
export function ensureBoards(userId: number, names: BoardNames): BoardSummary[] {
  const boards = listBoards(userId);
  if (boards.length) return boards;
  createBoard(userId, { name: names.board }, names);
  return listBoards(userId);
}

/** { id, name?, project?, notify? } */
export function updateBoard(userId: number, b: BoardInput): number {
  const id = ownBoard(userId, Number(b.id));
  transaction(() => {
    if (b.name !== undefined) run("UPDATE task_boards SET name = ? WHERE id = ?", text(b.name, 80) ?? fail("Name required"), id);
    if (typeof b.project === "boolean") run("UPDATE task_boards SET project = ? WHERE id = ?", b.project ? 1 : 0, id);
    if (typeof b.notify === "boolean") run("UPDATE task_boards SET notify = ? WHERE id = ?", b.notify ? 1 : 0, id);
  });
  return id;
}

/** Deletes the board with its lanes, columns and tasks. */
export function deleteBoard(userId: number, id: number): undefined {
  run("DELETE FROM task_boards WHERE id = ?", ownBoard(userId, id));
  return undefined;
}
