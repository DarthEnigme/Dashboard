import { localDay } from "../day";
import { nextDue, type RepeatUnit } from "./repeat";
import { all, lastOrd, one, run } from "./sql";
import type { CheckItem } from "./types";

interface Finished {
  id: number;
  lane_id: number | null;
  board_id: number;
  title: string;
  body: string;
  priority: number;
  due: string | null;
  labels: string;
  checklist: string;
  service_id: string | null;
  repeat_every: number;
  repeat_unit: RepeatUnit;
}

/**
 * Tasks that were just finished and repeat: each makes its next one, due one repeat later, in the
 * board's first open column (same lane, title, notes, labels, service and checklist, unticked). The
 * repeat moves on to the new task, so finishing the old one again, or opening it again, makes nothing
 * more. A board with no open column has nowhere to put it: the task then stays as it was.
 */
export function repeatFinished(ids: readonly number[], today = localDay()) {
  if (!ids.length) return;
  const rows = all<Finished>(
    `SELECT t.id, t.lane_id, c.board_id, t.title, t.body, t.priority, t.due, t.labels, t.checklist, t.service_id, t.repeat_every, t.repeat_unit
     FROM tasks t JOIN task_columns c ON c.id = t.column_id WHERE t.repeat_every IS NOT NULL AND t.id IN (${ids.map(() => "?").join(", ")})`,
    ...ids,
  );
  for (const t of rows) {
    const open = one<{ id: number }>("SELECT id FROM task_columns WHERE board_id = ? AND done = 0 ORDER BY ord, id LIMIT 1", t.board_id);
    if (!open) continue;
    const checklist = (JSON.parse(t.checklist) as CheckItem[]).map((c) => ({ ...c, done: false }));
    const now = Date.now();
    run(
      `INSERT INTO tasks (column_id, lane_id, title, body, priority, due, labels, checklist, service_id, repeat_every, repeat_unit, ord, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      open.id,
      t.lane_id,
      t.title,
      t.body,
      t.priority,
      nextDue(t.due, { every: t.repeat_every, unit: t.repeat_unit }, today),
      t.labels,
      JSON.stringify(checklist),
      t.service_id,
      t.repeat_every,
      t.repeat_unit,
      lastOrd("tasks", { column_id: open.id, lane_id: t.lane_id }),
      now,
      now,
    );
    run("UPDATE tasks SET repeat_every = NULL, repeat_unit = NULL WHERE id = ?", t.id);
  }
}
