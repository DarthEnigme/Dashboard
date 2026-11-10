"use client";

import { AlignLeft, CalendarDays } from "lucide-react";
import type { Task } from "@/lib/tasks/types";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { asLocal } from "@/lib/day";
import { overdue, PRIORITY_COLORS, PRIORITY_LABELS } from "./meta";

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

export function Labels({ labels }: { labels: string[] }) {
  return labels.map((l) => (
    <span key={l} className="rounded-full bg-accent/25 px-2 py-0.5 text-[11px] text-fg/90">
      {l}
    </span>
  ));
}

/** A task as it shows on the board: title, then whatever it has of priority, due date, labels and notes. */
export function TaskCard({ task, onOpen, dragging }: { task: Task; onOpen?: () => void; dragging?: boolean }) {
  const t = useT();
  const extras = task.priority > 0 || task.due || task.labels.length > 0 || task.body;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full cursor-grab flex-col gap-1.5 rounded-xl border border-line bg-chip px-3 py-2 text-left text-sm hover:border-accent/60 active:cursor-grabbing ${dragging ? "shadow-xl" : ""}`}
    >
      <span className={task.completed_at ? "text-muted line-through" : undefined}>{task.title}</span>
      {extras && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <PriorityDot priority={task.priority} />
          <DueDate task={task} />
          <Labels labels={task.labels} />
          {task.body && <AlignLeft className="h-3 w-3 text-muted" aria-label={t("Has notes")} />}
        </span>
      )}
    </button>
  );
}
