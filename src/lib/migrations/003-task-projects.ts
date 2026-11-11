import type { DatabaseSync } from "node:sqlite";

/** Schema step 3: lanes (rows across a board's columns), "blocked by" links between tasks, project mode and reminders per board. */
export function taskProjects(d: DatabaseSync) {
  d.exec(`
    ALTER TABLE task_boards ADD COLUMN project INTEGER NOT NULL DEFAULT 0;
    -- Due and overdue tasks of this board are sent to the alert channels.
    ALTER TABLE task_boards ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE task_lanes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      ord INTEGER NOT NULL,
      collapsed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX task_lanes_board ON task_lanes (board_id, ord);
    ALTER TABLE tasks ADD COLUMN lane_id INTEGER REFERENCES task_lanes(id) ON DELETE SET NULL;
    -- task_id waits for blocked_by (both on the same board).
    CREATE TABLE task_deps (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      blocked_by INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, blocked_by)
    );
    CREATE INDEX task_deps_blocker ON task_deps (blocked_by);
  `);
}
