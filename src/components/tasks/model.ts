import type { CheckItem, Priority, Repeat, Task } from "@/lib/tasks/types";

/** What the page and its parts pass around, apart from the board itself. */

/** A task as the dialog saves it (no id: a new one). Labels go as typed, comma-separated: the store splits them. */
export interface TaskDraft {
  id?: number;
  column: number;
  lane: number | null;
  title: string;
  body: string;
  priority: Priority;
  due: string | null;
  labels: string;
  blocked_by: number[];
  repeat: Repeat | null;
  checklist: CheckItem[];
  service: string | null;
}

/** Where a new task starts, and the service it is about when started from that service's page. */
export type NewTask = Pick<Task, "column_id" | "lane_id"> & { service?: string };

/** What can be asked of a column or a lane from its menu. */
export type PartChange = { rename: true } | { done: boolean } | { shift: -1 | 1 } | { remove: true };
/** The same, apart from renaming (which goes through the name dialog). */
export type PartMove = Exclude<PartChange, { rename: true }>;

/** What the one-field dialog is naming (no id: a new one). */
export type Naming = { what: "board" | "column" | "lane"; id?: number; name: string };
