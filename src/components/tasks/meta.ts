import { msg } from "@/i18n";
import { localDay } from "@/lib/day";
import type { Column, Priority, Task } from "@/lib/tasks/types";

export const PRIORITY_LABELS: Record<Priority, string> = { 0: msg("No priority"), 1: msg("Low"), 2: msg("Medium"), 3: msg("High") };
export const PRIORITY_COLORS: Record<Priority, string> = { 0: "var(--fg-muted)", 1: "var(--series-1)", 2: "var(--warn)", 3: "var(--err)" };

/** Past its due date and still open. */
export const overdue = (t: Pick<Task, "due" | "completed_at">) => t.due !== null && t.completed_at === null && t.due < localDay();

export interface Filter {
  text: string;
  label?: string;
  priority?: Priority;
}

export const filtering = (f: Filter) => f.text.trim() !== "" || f.label !== undefined || f.priority !== undefined;

const matches = (t: Task, f: Filter) => {
  const q = f.text.trim().toLowerCase();
  return (
    (!q || t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)) &&
    (f.label === undefined || t.labels.some((l) => l.toLowerCase() === f.label!.toLowerCase())) &&
    (f.priority === undefined || t.priority === f.priority)
  );
};

/** The columns with only the tasks the filter lets through. */
export const applyFilter = (columns: Column[], f: Filter): Column[] => (filtering(f) ? columns.map((c) => ({ ...c, tasks: c.tasks.filter((t) => matches(t, f)) })) : columns);
