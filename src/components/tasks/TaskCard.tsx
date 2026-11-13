"use client";

import { AlignLeft, CalendarDays, ListChecks, Lock, Repeat, Server } from "lucide-react";
import type { Task } from "@/lib/tasks/types";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { asLocal } from "@/lib/day";
import { overdue, PRIORITY_COLORS, PRIORITY_LABELS } from "./meta";

/** A task's title, crossed out once it is finished: the same everywhere a task shows. */
export function TaskTitle({ task }: { task: Pick<Task, "title" | "completed_at"> }) {
  return <span className={`break-words ${task.completed_at ? "text-muted line-through" : ""}`}>{task.title}</span>;
}

/** Priority as a dot with its name for screen readers (nothing for "no priority"). */
export function PriorityDot({ priority }: { priority: Task["priority"] }) {
  const t = useT();
  if (!priority) return null;
  return <span role="img" aria-label={t(PRIORITY_LABELS[priority])} title={t(PRIORITY_LABELS[priority])} className="h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_COLORS[priority] }} />;
}

export function DueDate({ task }: { task: Pick<Task, "due" | "completed_at"> }) {
  if (!task.due) return null;
  return (
    <span className={`flex items-center gap-1 ${overdue(task) ? "font-medium text-[var(--err)]" : "text-muted"}`}>
      <CalendarDays className="h-3 w-3" /> {dateOnly(asLocal(task.due))}
    </span>
  );
}

/** Waiting for other tasks that are still open. */
export function Blocked() {
  const t = useT();
  return (
    <span className="flex items-center gap-1 text-[var(--warn)]" title={t("Waits for tasks that are still open")}>
      <Lock className="h-3 w-3" /> {t("Waiting")}
    </span>
  );
}

export function Labels({ labels }: { labels: string[] }) {
  return labels.map((l) => (
    <span key={l} className="rounded-full bg-accent/25 px-2 py-0.5 text-[11px] text-fg/90">
      {l}
    </span>
  ));
}

/** Checklist progress, "2/5", in the ok colour once all are ticked (nothing without a checklist). */
export function Checks({ done, total }: { done: number; total: number }) {
  const t = useT();
  if (!total) return null;
  return (
    <span className={`flex items-center gap-1 tabular-nums ${done === total ? "text-[var(--ok)]" : "text-muted"}`} title={t("{done} of {total}", { done, total })}>
      <ListChecks className="h-3 w-3" /> {done}/{total}
    </span>
  );
}

/** A task as it shows on the board: title, then whatever it has of priority, due date, labels, checklist, repeat, service and notes. */
export function TaskCard({ task, onOpen, dragging }: { task: Task; onOpen?: () => void; dragging?: boolean }) {
  const t = useT();
  const extras = task.priority > 0 || task.due || task.labels.length > 0 || task.body || task.blocked || task.checklist.length > 0 || task.repeat || task.service;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full cursor-grab flex-col gap-1.5 rounded-xl border border-line bg-chip px-3 py-2 text-left text-sm hover:border-accent/60 active:cursor-grabbing ${dragging ? "shadow-xl" : ""}`}
    >
      <TaskTitle task={task} />
      {extras && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {task.blocked && <Blocked />}
          <PriorityDot priority={task.priority} />
          <DueDate task={task} />
          <Labels labels={task.labels} />
          <Checks done={task.checklist.filter((c) => c.done).length} total={task.checklist.length} />
          {task.repeat && <Repeat className="h-3 w-3 text-muted" aria-label={t("Repeats")} />}
          {task.service && <Server className="h-3 w-3 text-muted" aria-label={t("About service {name}", { name: task.service })} />}
          {task.body && <AlignLeft className="h-3 w-3 text-muted" aria-label={t("Has notes")} />}
        </span>
      )}
    </button>
  );
}
