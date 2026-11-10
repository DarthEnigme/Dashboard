"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Column, Task } from "@/lib/tasks/types";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { inputBase } from "../edit/FieldInput";
import { DueDate, Labels, PriorityDot } from "./TaskCard";
import { PRIORITY_LABELS } from "./meta";

type SortKey = "title" | "column" | "priority" | "due";
const HEADS: { key: SortKey; label: string }[] = [
  { key: "title", label: msg("Task") },
  { key: "column", label: msg("Column") },
  { key: "priority", label: msg("Priority") },
  { key: "due", label: msg("Due date") },
];

interface Props {
  columns: Column[];
  onOpen: (task: Task) => void;
  /** Send a task to another column (it lands last there). */
  onMove: (task: number, column: number) => void;
}

/** Every task of the board in one table: sort by a heading, change a task's column in place. */
export function ListView({ columns, onOpen, onMove }: Props) {
  const t = useT();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "column", dir: 1 });
  const order = new Map(columns.map((c, i) => [c.id, i]));
  const rows = columns.flatMap((c) => c.tasks);

  const compare: Record<SortKey, (a: Task, b: Task) => number> = {
    title: (a, b) => a.title.localeCompare(b.title),
    column: (a, b) => order.get(a.column_id)! - order.get(b.column_id)!,
    // High first.
    priority: (a, b) => b.priority - a.priority,
    // Soonest first, undated last.
    due: (a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"),
  };
  // The board's own order breaks ties (the sort is stable).
  const sorted = [...rows].sort((a, b) => compare[sort.key](a, b) * sort.dir);

  if (!rows.length) return <p className="glass rounded-3xl p-8 text-center text-muted">{t("No tasks here.")}</p>;

  return (
    <div className="glass overflow-x-auto rounded-3xl p-2">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {HEADS.map((h) => (
              <th key={h.key} scope="col" aria-sort={sort.key === h.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3 py-2 font-medium">
                <button type="button" onClick={() => setSort({ key: h.key, dir: sort.key === h.key && sort.dir === 1 ? -1 : 1 })} className="flex items-center gap-1 hover:text-fg">
                  {t(h.label)}
                  {sort.key === h.key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                </button>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 font-medium">
              {t("Labels")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((task) => (
            <tr key={task.id} className="border-t border-line hover:bg-hover">
              <td className="px-3 py-2">
                <button type="button" onClick={() => onOpen(task)} className={`text-left hover:text-accent ${task.completed_at ? "text-muted line-through" : ""}`}>
                  {task.title}
                </button>
              </td>
              <td className="px-3 py-1.5">
                <select value={task.column_id} onChange={(e) => onMove(task.id, Number(e.target.value))} aria-label={t("Column of {task}", { task: task.title })} className={`${inputBase} h-8 py-0 text-sm`}>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <PriorityDot priority={task.priority} />
                  {task.priority > 0 && t(PRIORITY_LABELS[task.priority])}
                </span>
              </td>
              <td className="px-3 py-2 text-xs">
                <DueDate task={task} />
              </td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap gap-1">
                  <Labels labels={task.labels} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
