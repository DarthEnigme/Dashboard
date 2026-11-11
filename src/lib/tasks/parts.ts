import { transaction } from "../db";
import { int, text } from "../clean";
import { setColumnDone } from "./rules";
import { bool, fail, lastOrd, one, ownBoard, ownColumn, ownLane, patch, place, run } from "./sql";
import type { PartInput } from "./types";

/**
 * Columns and lanes: the named, ordered parts of a board. They are made, renamed, moved and deleted
 * the same way; each has one checkbox (a column's "done", a lane's "collapsed").
 */
interface Part {
  id: number;
  board_id: number;
}
interface Spec<P extends Part> {
  table: "task_columns" | "task_lanes";
  noun: string;
  max: number;
  own: (userId: number, id: number) => P;
  /** What its checkbox does when it changes. */
  check: (part: P, on: boolean) => void;
  /** Throws when the part can't go yet. */
  beforeDelete?: (part: P) => void;
}

const name = (v: unknown) => text(v, 60) ?? fail("Name required");

function addPart<P extends Part>(spec: Spec<P>, userId: number, b: PartInput): number {
  const board = ownBoard(userId, Number(b.board));
  const n = name(b.name);
  if (one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${spec.table} WHERE board_id = ?`, board)!.n >= spec.max) fail(`A board can have up to ${spec.max} ${spec.noun}`);
  run(`INSERT INTO ${spec.table} (board_id, name, ord) VALUES (?, ?, ?)`, board, n, lastOrd(spec.table, { board_id: board }));
  return board;
}

function updatePart<P extends Part>(spec: Spec<P>, userId: number, b: PartInput, checkbox: unknown): number {
  const part = spec.own(userId, Number(b.id));
  transaction(() => {
    patch(spec.table, part.id, { name: b.name === undefined ? undefined : name(b.name) });
    if (typeof checkbox === "boolean") spec.check(part, checkbox);
    if (b.index !== undefined) place(spec.table, { board_id: part.board_id }, part.id, int(b.index, 0, spec.max) ?? fail("Bad position"));
  });
  return part.board_id;
}

function deletePart<P extends Part>(spec: Spec<P>, userId: number, id: number): number {
  const part = spec.own(userId, id);
  spec.beforeDelete?.(part);
  run(`DELETE FROM ${spec.table} WHERE id = ?`, part.id);
  return part.board_id;
}

const COLUMNS: Spec<ReturnType<typeof ownColumn>> = {
  table: "task_columns",
  noun: "columns",
  max: 12,
  own: ownColumn,
  // Its tasks become finished, or open again, with the column.
  check: (column, done) => done !== (column.done === 1) && setColumnDone(column.id, done),
  // Only an empty column goes: its tasks are moved or deleted first, so none vanish with it.
  beforeDelete: (column) => void (one("SELECT 1 FROM tasks WHERE column_id = ? LIMIT 1", column.id) && fail("Move or delete this column's tasks first")),
};

/** Lanes: rows across a board's columns that group its tasks. A board without lanes is one implicit row. */
const LANES: Spec<ReturnType<typeof ownLane>> = {
  table: "task_lanes",
  noun: "lanes",
  max: 20,
  own: ownLane,
  check: (lane, collapsed) => patch("task_lanes", lane.id, { collapsed: bool(collapsed) }),
};

/** { board, name } */
export const addColumn = (userId: number, b: PartInput) => addPart(COLUMNS, userId, b);
/** { id, name?, done?, index? }: rename, mark as the "done" kind, or move among the board's columns. */
export const updateColumn = (userId: number, b: PartInput) => updatePart(COLUMNS, userId, b, b.done);
export const deleteColumn = (userId: number, id: number) => deletePart(COLUMNS, userId, id);

/** { board, name } */
export const addLane = (userId: number, b: PartInput) => addPart(LANES, userId, b);
/** { id, name?, collapsed?, index? } */
export const updateLane = (userId: number, b: PartInput) => updatePart(LANES, userId, b, b.collapsed);
/** The lane goes; its tasks stay, with no lane. */
export const deleteLane = (userId: number, id: number) => deletePart(LANES, userId, id);
