import { transaction } from "../db";
import { text } from "../clean";
import { all, bool, fail, ownBoard, patch, run } from "./sql";
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

/** This person's boards, after giving them a first one if they have none (checked and made at once, so never twice). */
export const ensureBoards = (userId: number, names: BoardNames): BoardSummary[] =>
  transaction(() => {
    if (!listBoards(userId).length) createBoard(userId, { name: names.board }, names);
    return listBoards(userId);
  });

/** { id, name?, project?, notify? } */
export function updateBoard(userId: number, b: BoardInput): number {
  const id = ownBoard(userId, Number(b.id));
  patch("task_boards", id, { name: b.name === undefined ? undefined : (text(b.name, 80) ?? fail("Name required")), project: bool(b.project), notify: bool(b.notify) });
  return id;
}

/** Deletes the board with its lanes, columns and tasks. Returns its (now unknown) id, so the answer falls back to another board. */
export function deleteBoard(userId: number, id: number): number {
  const board = ownBoard(userId, id);
  run("DELETE FROM task_boards WHERE id = ?", board);
  return board;
}
