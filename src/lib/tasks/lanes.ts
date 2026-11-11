import { transaction } from "../db";
import { int, text } from "../clean";
import type { PartInput } from "./types";
import { fail, lastOrd, one, ownBoard, ownLane, place, run } from "./sql";

/** Lanes: rows across a board's columns that group its tasks. A board without lanes is one implicit row. */
const MAX_LANES = 20;

/** { board, name } */
export function addLane(userId: number, b: PartInput): number {
  const board = ownBoard(userId, Number(b.board));
  const name = text(b.name, 60) ?? fail("Name required");
  if (one<{ n: number }>("SELECT COUNT(*) AS n FROM task_lanes WHERE board_id = ?", board)!.n >= MAX_LANES) fail(`A board can have up to ${MAX_LANES} lanes`);
  run("INSERT INTO task_lanes (board_id, name, ord) VALUES (?, ?, ?)", board, name, lastOrd("task_lanes", { board_id: board }));
  return board;
}

/** { id, name?, collapsed?, index? } */
export function updateLane(userId: number, b: PartInput): number {
  const lane = ownLane(userId, Number(b.id));
  transaction(() => {
    if (b.name !== undefined) run("UPDATE task_lanes SET name = ? WHERE id = ?", text(b.name, 60) ?? fail("Name required"), lane.id);
    if (typeof b.collapsed === "boolean") run("UPDATE task_lanes SET collapsed = ? WHERE id = ?", b.collapsed ? 1 : 0, lane.id);
    if (b.index !== undefined) place("task_lanes", { board_id: lane.board_id }, lane.id, int(b.index, 0, MAX_LANES) ?? fail("Bad position"));
  });
  return lane.board_id;
}

/** The lane goes; its tasks stay, with no lane. */
export function deleteLane(userId: number, id: number): number {
  const lane = ownLane(userId, id);
  run("DELETE FROM task_lanes WHERE id = ?", lane.id);
  return lane.board_id;
}
