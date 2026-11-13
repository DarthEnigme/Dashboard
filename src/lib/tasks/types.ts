/** The shapes of the Tasks app, shared by the server's store and the page (nothing here touches the database). */
import type { Repeat } from "./repeat";

export type { Repeat, RepeatUnit } from "./repeat";
export const PRIORITIES = [0, 1, 2, 3] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Task {
  id: number;
  column_id: number;
  /** The lane (row) it sits in; null for "no lane". */
  lane_id: number | null;
  title: string;
  /** Markdown. */
  body: string;
  /** 0 none, 1 low, 2 medium, 3 high. */
  priority: Priority;
  due: string | null;
  labels: string[];
  created_at: number;
  /** When it reached a "done" column; null while it is open. */
  completed_at: number | null;
  /** The tasks it waits for (on the same board). */
  blocked_by: number[];
  /** Open, and some task it waits for is still open: it can't be finished yet. */
  blocked: boolean;
  /** Null: done once. Finishing a repeating task makes the next one (and the repeat moves to it). */
  repeat: Repeat | null;
  checklist: CheckItem[];
  /** The service (config id) it is about: it shows on that service's page. */
  service: string | null;
}

export interface CheckItem {
  text: string;
  done: boolean;
}

/** A service a task can be about. */
export interface ServiceRef {
  id: string;
  name: string;
  group: string;
}

export interface Column {
  id: number;
  name: string;
  /** Tasks here count as finished. */
  done: boolean;
  tasks: Task[];
}

/** A row across all of a board's columns, to group tasks (a task is in one lane, or none). */
export interface Lane {
  id: number;
  name: string;
  collapsed: boolean;
}

export interface BoardSummary {
  id: number;
  name: string;
}

export interface Board extends BoardSummary {
  /** Project mode: tasks wait for one another and the board shows its steps and progress. */
  project: boolean;
  /** Due and overdue tasks are sent to the alert channels. */
  notify: boolean;
  lanes: Lane[];
  columns: Column[];
}

export interface TasksData {
  boards: BoardSummary[];
  board: Board;
  /** Every label in use on this board, for suggestions and filters. */
  labels: string[];
  /** Whether any alert channel is set up (otherwise a board can't send reminders). */
  alerts: boolean;
  /** The services a task can be linked to. */
  services: ServiceRef[];
}

/** An open task about a service, for that service's page. */
export interface ServiceTask {
  id: number;
  title: string;
  due: string | null;
  priority: Priority;
  board_id: number;
  board: string;
  /** Checklist progress: done of total (0 of 0 without one). */
  checked: number;
  checks: number;
}

/** An open task with a due date that is past or close, wherever it is. */
export interface DueTask {
  id: number;
  title: string;
  due: string;
  board_id: number;
  board: string;
  overdue: boolean;
}

/** One person's tasks at a glance: for the reminders and the dashboard widget. */
export interface TasksSummary {
  open: number;
  overdue: number;
  /** Overdue first, then due soon; soonest first. */
  due: DueTask[];
}

// ---------- what clients send: unchecked, the store cleans every field ----------

export interface BoardInput {
  id?: unknown;
  name?: unknown;
  project?: unknown;
  notify?: unknown;
}
/** A column or a lane: made on `board`, or changed by `id`; `index` moves it among its siblings. */
export interface PartInput {
  id?: unknown;
  board?: unknown;
  name?: unknown;
  index?: unknown;
  /** Columns: tasks here count as finished. */
  done?: unknown;
  /** Lanes: folded on the board. */
  collapsed?: unknown;
}
/** A task: made in `column`, or changed by `id`; `column`, `lane` and `index` move it. */
export interface TaskInput {
  id?: unknown;
  column?: unknown;
  lane?: unknown;
  index?: unknown;
  title?: unknown;
  body?: unknown;
  priority?: unknown;
  due?: unknown;
  labels?: unknown;
  blocked_by?: unknown;
  /** { every, unit }, or null to stop repeating. */
  repeat?: unknown;
  /** [{ text, done }] */
  checklist?: unknown;
  /** A service id, or null / "" for none. */
  service?: unknown;
}

/** Default names for a first board, in the reader's language. */
export interface BoardNames {
  board: string;
  columns: [todo: string, doing: string, done: string];
}
