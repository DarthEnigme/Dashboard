import { db, transaction } from "../db";
import { cleanTags, day, int, parseTags, text } from "../clean";
import type { BoardNames, BoardSummary, Priority, Task, TasksData } from "./types";

export type * from "./types";

/**
 * Task boards, private to their owner: a board has ordered columns, a column has ordered tasks.
 * Every change returns the id of the board it touched, so the route can answer with that board.
 */
const MAX_BODY = 20_000;
const MAX_BOARDS = 50;
const MAX_COLUMNS = 12;

const fail = (message: string): never => {
  throw new Error(message);
};
const run = (sql: string, ...args: (string | number | null)[]) => db().prepare(sql).run(...args);
const one = <T>(sql: string, ...args: (string | number | null)[]) => db().prepare(sql).get(...args) as T | undefined;
const all = <T>(sql: string, ...args: (string | number | null)[]) => db().prepare(sql).all(...args) as unknown as T[];

// ---------- reading ----------

export const listBoards = (userId: number) => all<BoardSummary>("SELECT id, name FROM task_boards WHERE owner_id = ? ORDER BY created_at, id", userId);

/**
 * The board `boardId` (or this person's first one) with its columns and tasks. Someone with no
 * board yet gets one, with the three usual columns named by `names` (the caller's language).
 */
export function loadBoard(userId: number, boardId: number | undefined, names: BoardNames): TasksData {
  let boards = listBoards(userId);
  if (!boards.length) {
    createBoard(userId, { name: names.board }, names);
    boards = listBoards(userId);
  }
  const summary = boards.find((b) => b.id === boardId) ?? boards[0];
  const columns = all<{ id: number; name: string; done: number }>("SELECT id, name, done FROM task_columns WHERE board_id = ? ORDER BY ord, id", summary.id);
  const rows = all<Omit<Task, "labels"> & { labels: string | null }>(
    `SELECT t.id, t.column_id, t.title, t.body, t.priority, t.due, t.labels, t.created_at, t.completed_at
     FROM tasks t JOIN task_columns c ON c.id = t.column_id WHERE c.board_id = ? ORDER BY t.ord, t.id`,
    summary.id,
  );
  const tasks = rows.map((r) => ({ ...r, labels: parseTags(r.labels) }));
  const labels = [...new Map(tasks.flatMap((t) => t.labels).map((l) => [l.toLowerCase(), l])).values()].sort((a, b) => a.localeCompare(b));
  return {
    boards,
    board: { ...summary, columns: columns.map((c) => ({ id: c.id, name: c.name, done: c.done === 1, tasks: tasks.filter((t) => t.column_id === c.id) })) },
    labels,
  };
}

// ---------- ownership ----------

const ownBoard = (userId: number, id: number) => one<{ id: number }>("SELECT id FROM task_boards WHERE id = ? AND owner_id = ?", id, userId)?.id ?? fail("No such board");

const ownColumn = (userId: number, id: number) =>
  one<{ id: number; board_id: number; done: number }>("SELECT c.id, c.board_id, c.done FROM task_columns c JOIN task_boards b ON b.id = c.board_id WHERE c.id = ? AND b.owner_id = ?", id, userId) ??
  fail("No such column");

const ownTask = (userId: number, id: number) =>
  one<{ id: number; column_id: number; board_id: number; completed_at: number | null }>(
    `SELECT t.id, t.column_id, c.board_id, t.completed_at FROM tasks t JOIN task_columns c ON c.id = t.column_id JOIN task_boards b ON b.id = c.board_id
     WHERE t.id = ? AND b.owner_id = ?`,
    id,
    userId,
  ) ?? fail("No such task");

// ---------- ordering ----------

/** Put `id` at `index` among its siblings and renumber them (index past the end, or missing, means last). */
function place(table: "tasks" | "task_columns", parent: "column_id" | "board_id", parentId: number, id: number, index: number | null) {
  const ids = all<{ id: number }>(`SELECT id FROM ${table} WHERE ${parent} = ? AND id != ? ORDER BY ord, id`, parentId, id).map((r) => r.id);
  ids.splice(index === null ? ids.length : Math.min(index, ids.length), 0, id);
  ids.forEach((sibling, ord) => run(`UPDATE ${table} SET ord = ? WHERE id = ?`, ord, sibling));
}

// ---------- boards ----------

export function createBoard(userId: number, b: Record<string, unknown>, names: BoardNames): number {
  const name = text(b.name, 80) ?? fail("Name required");
  if (listBoards(userId).length >= MAX_BOARDS) fail(`A person can have up to ${MAX_BOARDS} boards`);
  return transaction(() => {
    const id = Number(run("INSERT INTO task_boards (owner_id, name, created_at) VALUES (?, ?, ?)", userId, name, Date.now()).lastInsertRowid);
    names.columns.forEach((column, ord) => run("INSERT INTO task_columns (board_id, name, ord, done) VALUES (?, ?, ?, ?)", id, column, ord, ord === names.columns.length - 1 ? 1 : 0));
    return id;
  });
}

export function renameBoard(userId: number, id: number, b: Record<string, unknown>) {
  run("UPDATE task_boards SET name = ? WHERE id = ?", text(b.name, 80) ?? fail("Name required"), ownBoard(userId, id));
}

/** Deletes the board with its columns and tasks. */
export function deleteBoard(userId: number, id: number) {
  run("DELETE FROM task_boards WHERE id = ?", ownBoard(userId, id));
}

// ---------- columns ----------

export function addColumn(userId: number, b: Record<string, unknown>): number {
  const board = ownBoard(userId, Number(b.board));
  const name = text(b.name, 60) ?? fail("Name required");
  const { n, last } = one<{ n: number; last: number }>("SELECT COUNT(*) AS n, COALESCE(MAX(ord), -1) + 1 AS last FROM task_columns WHERE board_id = ?", board)!;
  if (n >= MAX_COLUMNS) fail(`A board can have up to ${MAX_COLUMNS} columns`);
  run("INSERT INTO task_columns (board_id, name, ord, done) VALUES (?, ?, ?, 0)", board, name, last);
  return board;
}

/** { id, name?, done?, index? }: rename, mark as the "done" kind, or move among the board's columns. */
export function updateColumn(userId: number, b: Record<string, unknown>): number {
  const column = ownColumn(userId, Number(b.id));
  transaction(() => {
    if (b.name !== undefined) run("UPDATE task_columns SET name = ? WHERE id = ?", text(b.name, 60) ?? fail("Name required"), column.id);
    if (typeof b.done === "boolean" && b.done !== (column.done === 1)) {
      run("UPDATE task_columns SET done = ? WHERE id = ?", b.done ? 1 : 0, column.id);
      // Its tasks become finished, or open again, with the column.
      if (b.done) run("UPDATE tasks SET completed_at = ? WHERE column_id = ? AND completed_at IS NULL", Date.now(), column.id);
      else run("UPDATE tasks SET completed_at = NULL WHERE column_id = ?", column.id);
    }
    if (b.index !== undefined) place("task_columns", "board_id", column.board_id, column.id, int(b.index, 0, MAX_COLUMNS) ?? fail("Bad position"));
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

// ---------- tasks ----------

function fields(b: Record<string, unknown>) {
  const out: Partial<Pick<Task, "title" | "body" | "priority" | "due">> & { labels?: string } = {};
  if (b.title !== undefined) out.title = text(b.title, 200) ?? fail("Title required");
  if (b.body !== undefined) {
    out.body = typeof b.body === "string" ? b.body : "";
    if (out.body.length > MAX_BODY) fail("A task's notes can hold up to 20,000 characters");
  }
  if (b.priority !== undefined) out.priority = (int(b.priority, 0, 3) ?? fail("Priority is 0 to 3")) as Priority;
  if (b.due !== undefined) out.due = b.due === null || b.due === "" ? null : (day(b.due) ?? fail("The due date must be YYYY-MM-DD"));
  if (b.labels !== undefined) out.labels = JSON.stringify(cleanTags(b.labels));
  return out;
}

/** { column, title, body?, priority?, due?, labels? }: a new task, last in its column. */
export function addTask(userId: number, b: Record<string, unknown>): number {
  const column = ownColumn(userId, Number(b.column));
  const f = fields({ ...b, title: b.title ?? "" });
  const now = Date.now();
  const last = one<{ n: number }>("SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM tasks WHERE column_id = ?", column.id)!.n;
  run(
    "INSERT INTO tasks (column_id, title, body, priority, due, labels, ord, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    column.id,
    f.title!,
    f.body ?? "",
    f.priority ?? 0,
    f.due ?? null,
    f.labels ?? "[]",
    last,
    now,
    now,
    column.done ? now : null,
  );
  return column.board_id;
}

/** { id, …fields to change, column?, index? }: `column` and `index` move it (within its board). */
export function updateTask(userId: number, b: Record<string, unknown>): number {
  const task = ownTask(userId, Number(b.id));
  const f = fields(b);
  transaction(() => {
    const sets = Object.keys(f) as (keyof typeof f)[];
    if (sets.length) run(`UPDATE tasks SET ${sets.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, ...sets.map((k) => f[k] ?? null), Date.now(), task.id);
    if (b.column === undefined && b.index === undefined) return;
    const to = b.column === undefined ? undefined : ownColumn(userId, Number(b.column));
    if (to && to.board_id !== task.board_id) fail("A task stays on its board");
    if (to && to.id !== task.column_id) {
      // Finished when it enters a "done" column (keeping the first time), open again when it leaves.
      run("UPDATE tasks SET column_id = ?, completed_at = ? WHERE id = ?", to.id, to.done ? (task.completed_at ?? Date.now()) : null, task.id);
    }
    place("tasks", "column_id", to?.id ?? task.column_id, task.id, b.index === undefined ? null : (int(b.index, 0, 100_000) ?? fail("Bad position")));
  });
  return task.board_id;
}

export function deleteTask(userId: number, id: number): number {
  const task = ownTask(userId, id);
  run("DELETE FROM tasks WHERE id = ?", task.id);
  return task.board_id;
}
