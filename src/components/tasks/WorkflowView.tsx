"use client";

import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import type { Column, Task } from "@/lib/tasks/types";
import { steps } from "@/lib/tasks/graph";
import { useT } from "@/i18n/client";
import { Blocked, DueDate, PriorityDot, TaskTitle } from "./TaskCard";

/** A project's tasks in the order they can be done: each step only waits for earlier ones. */
export function WorkflowView({ columns, onOpen }: { columns: Column[]; onOpen: (task: Task) => void }) {
  const t = useT();
  const where = new Map(columns.map((c) => [c.id, c.name]));
  const stages = steps(columns.flatMap((c) => c.tasks));
  if (!stages.length) return <p className="glass rounded-3xl p-8 text-center text-muted">{t("No tasks here.")}</p>;

  return (
    <div className="flex items-start gap-2 overflow-x-auto pb-2">
      {stages.map((stage, i) => {
        const done = stage.filter((x) => x.completed_at !== null).length;
        return (
          <div key={i} className="flex items-start gap-2">
            {i > 0 && <ArrowRight className="mt-4 h-4 w-4 shrink-0 text-muted" aria-hidden />}
            <section aria-label={t("Step {n}", { n: i + 1 })} className="glass flex w-64 shrink-0 flex-col gap-2 rounded-3xl p-3">
              <header className="flex items-center justify-between px-1 text-sm font-semibold">
                {t("Step {n}", { n: i + 1 })}
                <span className="text-xs font-normal text-muted tabular-nums">
                  {done}/{stage.length}
                </span>
              </header>
              <ul className="flex flex-col gap-2">
                {stage.map((task) => (
                  <li key={task.id}>
                    <button type="button" onClick={() => onOpen(task)} className="flex w-full flex-col gap-1.5 rounded-xl border border-line bg-chip px-3 py-2 text-left text-sm hover:border-accent/60">
                      <span className="flex items-start gap-2">
                        {task.completed_at ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ok)]" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                        <TaskTitle task={task} />
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span className="rounded-full bg-hover px-2 py-0.5">{where.get(task.column_id)}</span>
                        {task.blocked && <Blocked />}
                        <PriorityDot priority={task.priority} />
                        <DueDate task={task} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        );
      })}
    </div>
  );
}

/** How far a project has come: finished tasks out of all of them. */
export function Progress({ columns }: { columns: Column[] }) {
  const t = useT();
  const tasks = columns.flatMap((c) => c.tasks);
  const done = tasks.filter((x) => x.completed_at !== null).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-xs text-muted" role="group" aria-label={t("Progress")}>
      <div className="h-2 w-48 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums">{t("{done} of {n} done ({pct}%)", { done, n: tasks.length, pct })}</span>
    </div>
  );
}
