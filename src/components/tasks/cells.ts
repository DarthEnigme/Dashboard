import type { UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { Board, Column, Lane, Task } from "@/lib/tasks/types";

/**
 * The board as a grid: one row per lane, then "no lane". A board without lanes is just the "no lane"
 * row, so drawing and dragging work the same either way.
 */
export type LaneId = number | null;
export interface Cell {
  column: number;
  lane: LaneId;
}

export const rowsOf = (board: Pick<Board, "lanes">): (Lane | null)[] => [...board.lanes, null];
export const cellKey = ({ column, lane }: Cell) => `cell:${lane ?? "none"}:${column}`;
export const inCell = (column: Column, lane: LaneId) => column.tasks.filter((t) => t.lane_id === lane);

const same = (a: Cell, b: Cell) => a.column === b.column && a.lane === b.lane;
const cellOfTask = (t: Task): Cell => ({ column: t.column_id, lane: t.lane_id });

/** The cell a drag is over: the one with that key, or the one holding that task. */
export function cellOf(columns: Column[], id: UniqueIdentifier): Cell | undefined {
  const m = typeof id === "string" ? /^cell:(none|\d+):(\d+)$/.exec(id) : null;
  if (m) return { column: Number(m[2]), lane: m[1] === "none" ? null : Number(m[1]) };
  const task = columns.flatMap((c) => c.tasks).find((t) => t.id === id);
  return task && cellOfTask(task);
}

/** The board with `task` taken out of its cell and put in `to`: before the task `before`, else last. */
export function moveToCell(columns: Column[], task: Task, to: Cell, before?: UniqueIdentifier): Column[] {
  const moved = { ...task, column_id: to.column, lane_id: to.lane };
  return columns.map((c) => {
    const tasks = c.tasks.filter((t) => t.id !== task.id);
    if (c.id !== to.column) return tasks.length === c.tasks.length ? c : { ...c, tasks };
    const at = tasks.findIndex((t) => t.id === before);
    return { ...c, tasks: at < 0 ? [...tasks, moved] : [...tasks.slice(0, at), moved, ...tasks.slice(at)] };
  });
}

/**
 * Where a drop leaves the dragged task: its cell, its index there and the board as it should look, or
 * nothing when it ends where it started (in `before`).
 */
export function dropResult(before: Column[], during: Column[], active: UniqueIdentifier, over: UniqueIdentifier | undefined) {
  const cell = cellOf(during, active);
  const column = during.find((c) => c.id === cell?.column);
  if (!cell || !column) return undefined;
  const tasks = inCell(column, cell.lane);
  const from = tasks.findIndex((t) => t.id === active);
  const to = over === undefined ? -1 : tasks.findIndex((t) => t.id === over);
  const ordered = to >= 0 && to !== from ? arrayMove(tasks, from, to) : tasks;
  const index = ordered.findIndex((t) => t.id === active);
  // The cell's tasks take their new order, in the places the cell has in the column.
  let i = 0;
  const columnTasks = column.tasks.map((t) => (same(cellOfTask(t), cell) ? ordered[i++] : t));
  const was = before.flatMap((c) => c.tasks).find((t) => t.id === active);
  if (was && same(cellOfTask(was), cell) && inCell(before.find((c) => c.id === cell.column)!, cell.lane).findIndex((t) => t.id === active) === index) return undefined;
  return { cell, index, columns: during.map((c) => (c === column ? { ...c, tasks: columnTasks } : c)) };
}
