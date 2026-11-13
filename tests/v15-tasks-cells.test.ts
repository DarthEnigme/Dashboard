import { describe, expect, it } from "vitest";
import { cellKey, cellOf, dropResult, inCell, moveToCell, rowsOf } from "@/components/tasks/cells";
import type { Column, Task } from "@/lib/tasks/types";

const task = (id: number, column_id: number, lane_id: number | null = null): Task => ({
  id,
  column_id,
  lane_id,
  title: `t${id}`,
  body: "",
  priority: 0,
  due: null,
  labels: [],
  created_at: 0,
  completed_at: null,
  blocked_by: [],
  blocked: false,
  repeat: null,
  checklist: [],
  service: null,
});
const col = (id: number, tasks: Task[]): Column => ({ id, name: `c${id}`, done: false, tasks });
const ids = (columns: Column[]) => columns.map((c) => c.tasks.map((t) => [t.id, t.lane_id]));

// Column 1 holds tasks in lane 7 and in no lane; column 2 is empty.
const board = () => [col(1, [task(1, 1, 7), task(2, 1), task(3, 1, 7)]), col(2, [])];

describe("the board as a grid of cells", () => {
  it("has a row per lane, then no lane", () => {
    expect(rowsOf({ lanes: [] })).toEqual([null]);
    expect(rowsOf({ lanes: [{ id: 7, name: "L", collapsed: false }] }).map((l) => l?.id ?? null)).toEqual([7, null]);
    expect(inCell(board()[0], 7).map((t) => t.id)).toEqual([1, 3]);
  });

  it("finds the cell of a key or of a task", () => {
    expect(cellOf(board(), cellKey({ column: 2, lane: null }))).toEqual({ column: 2, lane: null });
    expect(cellOf(board(), cellKey({ column: 2, lane: 7 }))).toEqual({ column: 2, lane: 7 });
    expect(cellOf(board(), 3)).toEqual({ column: 1, lane: 7 });
    expect(cellOf(board(), 99)).toBeUndefined();
  });

  it("moves a task to another lane and column, before a task or last", () => {
    const b = board();
    expect(ids(moveToCell(b, b[0].tasks[0], { column: 2, lane: null }))).toEqual([[[2, null], [3, 7]], [[1, null]]]);
    expect(ids(moveToCell(b, b[0].tasks[2], { column: 1, lane: null }, 2))).toEqual([[[1, 7], [3, null], [2, null]], []]);
  });
});

describe("a drop", () => {
  it("gives the cell and the index there, reordering within the cell only", () => {
    const before = board();
    // Task 3 dropped over task 1, both in lane 7: it becomes first of that cell; task 2 (no lane) keeps its place.
    const drop = dropResult(before, before, 3, 1)!;
    expect(drop.cell).toEqual({ column: 1, lane: 7 });
    expect(drop.index).toBe(0);
    expect(ids(drop.columns)[0]).toEqual([[3, 7], [2, null], [1, 7]]);
  });

  it("follows a task dragged into another cell", () => {
    const before = board();
    const during = moveToCell(before, before[0].tasks[0], { column: 2, lane: 7 });
    expect(dropResult(before, during, 1, cellKey({ column: 2, lane: 7 }))).toMatchObject({ cell: { column: 2, lane: 7 }, index: 0 });
  });

  it("is nothing when the task ends where it started", () => {
    const before = board();
    expect(dropResult(before, before, 1, 1)).toBeUndefined();
    expect(dropResult(before, before, 1, undefined)).toBeUndefined();
  });
});
