/** The shapes of the Tasks app, shared by the server's store and the page (nothing here touches the database). */
export const PRIORITIES = [0, 1, 2, 3] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Task {
  id: number;
  column_id: number;
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
}

export interface Column {
  id: number;
  name: string;
  /** Tasks here count as finished. */
  done: boolean;
  tasks: Task[];
}

export interface BoardSummary {
  id: number;
  name: string;
}

export interface Board extends BoardSummary {
  columns: Column[];
}

export interface TasksData {
  boards: BoardSummary[];
  board: Board;
  /** Every label in use on this board, for suggestions and filters. */
  labels: string[];
}

/** Default names for a first board, in the reader's language. */
export interface BoardNames {
  board: string;
  columns: [todo: string, doing: string, done: string];
}
