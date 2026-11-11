import { transaction } from "../db";
import { cleanTags, day, int, text } from "../clean";
import { createsCycle } from "./graph";
import { boardWaits, checkNewBlockers, enterColumn } from "./rules";
import { all, fail, lastOrd, ownColumn, ownLane, ownTask, patch, place, run, type ColumnRow, type TaskRow } from "./sql";
import { PRIORITIES, type Task, type TaskInput } from "./types";

const MAX_BODY = 20_000;
const MAX_BLOCKERS = 20;

/** A lane given by the client (null or "" for none), checked to be on `boardId`. */
function laneOn(userId: number, v: unknown, boardId: number): number | null {
  if (v === null || v === "") return null;
  const lane = ownLane(userId, Number(v));
  if (lane.board_id !== boardId) fail("A task stays on its board");
  return lane.id;
}

/** The tasks `task` waits for, replaced: all on its board, none of them itself, and no loop. Returns those it didn't wait for before. */
function setBlockers(task: Pick<TaskRow, "id" | "board_id">, v: unknown): number[] {
  if (!Array.isArray(v)) fail("Blocked by: a list of tasks");
  const ids = [...new Set((v as unknown[]).map(Number))];
  if (ids.length > MAX_BLOCKERS) fail(`A task can wait for up to ${MAX_BLOCKERS} others`);
  if (ids.includes(task.id)) fail("A task can't wait for itself");
  const onBoard = new Set(all<{ id: number }>("SELECT t.id FROM tasks t JOIN task_columns c ON c.id = t.column_id WHERE c.board_id = ?", task.board_id).map((r) => r.id));
  if (!ids.every((id) => onBoard.has(id))) fail("A task can only wait for tasks on its board");
  if (createsCycle(boardWaits(task.board_id), task.id, ids)) fail("That would make tasks wait for each other in a loop");
  const before = new Set(all<{ blocked_by: number }>("SELECT blocked_by FROM task_deps WHERE task_id = ?", task.id).map((r) => r.blocked_by));
  run("DELETE FROM task_deps WHERE task_id = ?", task.id);
  for (const id of ids) run("INSERT INTO task_deps (task_id, blocked_by) VALUES (?, ?)", task.id, id);
  return ids.filter((id) => !before.has(id));
}

// ---------- fields ----------

function fields(b: TaskInput) {
  const out: Partial<Pick<Task, "title" | "body" | "priority" | "due">> & { labels?: string } = {};
  if (b.title !== undefined) out.title = text(b.title, 200) ?? fail("Title required");
  if (b.body !== undefined) {
    out.body = typeof b.body === "string" ? b.body : "";
    if (out.body.length > MAX_BODY) fail("A task's notes can hold up to 20,000 characters");
  }
  if (b.priority !== undefined) out.priority = PRIORITIES.find((p) => p === int(b.priority, 0, 3)) ?? fail("Priority is 0 to 3");
  if (b.due !== undefined) out.due = b.due === null || b.due === "" ? null : (day(b.due) ?? fail("The due date must be YYYY-MM-DD"));
  if (b.labels !== undefined) out.labels = JSON.stringify(cleanTags(b.labels));
  return out;
}

// ---------- changes ----------

/** { column, title, lane?, blocked_by?, body?, priority?, due?, labels? }: a new task, last in its cell. */
export function addTask(userId: number, b: TaskInput): number {
  const column = ownColumn(userId, Number(b.column));
  const lane = b.lane === undefined ? null : laneOn(userId, b.lane, column.board_id);
  const f = fields(b);
  const title = f.title ?? fail("Title required");
  const now = Date.now();
  transaction(() => {
    const id = Number(
      run(
        "INSERT INTO tasks (column_id, lane_id, title, body, priority, due, labels, ord, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        column.id,
        lane,
        title,
        f.body ?? "",
        f.priority ?? 0,
        f.due ?? null,
        f.labels ?? "[]",
        lastOrd("tasks", { column_id: column.id, lane_id: lane }),
        now,
        now,
      ).lastInsertRowid,
    );
    if (b.blocked_by !== undefined) setBlockers({ id, board_id: column.board_id }, b.blocked_by);
    enterColumn({ id, completed_at: null }, column);
  });
  return column.board_id;
}

/**
 * { id, …fields to change, column?, lane?, index?, blocked_by? }. `column`, `lane` and `index` move it
 * within its board; it only changes place when one of them says so.
 */
export function updateTask(userId: number, b: TaskInput): number {
  const task = ownTask(userId, Number(b.id));
  const f = fields(b);
  const to: ColumnRow = b.column === undefined ? { id: task.column_id, board_id: task.board_id, done: task.column_done } : ownColumn(userId, Number(b.column));
  if (to.board_id !== task.board_id) fail("A task stays on its board");
  const lane = b.lane === undefined ? task.lane_id : laneOn(userId, b.lane, task.board_id);
  const index = b.index === undefined ? null : (int(b.index, 0, 100_000) ?? fail("Bad position"));
  const entered = to.id !== task.column_id;
  const moved = entered || lane !== task.lane_id;
  transaction(() => {
    patch("tasks", task.id, { ...f, updated_at: Object.keys(f).length ? Date.now() : undefined });
    const added = b.blocked_by === undefined ? [] : setBlockers(task, b.blocked_by);
    if (entered) enterColumn(task, to);
    else checkNewBlockers(task, to, added);
    if (lane !== task.lane_id) run("UPDATE tasks SET lane_id = ? WHERE id = ?", lane, task.id);
    if (moved || b.index !== undefined) place("tasks", { column_id: to.id, lane_id: lane }, task.id, index);
  });
  return task.board_id;
}

export function deleteTask(userId: number, id: number): number {
  const task = ownTask(userId, id);
  run("DELETE FROM tasks WHERE id = ?", task.id);
  return task.board_id;
}
