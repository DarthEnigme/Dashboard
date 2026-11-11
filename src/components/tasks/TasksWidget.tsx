"use client";

import Link from "next/link";
import { ListTodo } from "lucide-react";
import { taskHref } from "@/lib/tasks/links";
import { asLocal, localDay } from "@/lib/day";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { useTasksSummary } from "./useTasksSummary";

/** Open and overdue tasks, and the next one due. Personal: shows nothing without the tasks permission. */
export function TasksWidget({ label }: { label?: string }) {
  const t = useT();
  const { data, error } = useTasksSummary();
  if (error || !data) return null;
  const next = data.due[0];
  return (
    <Link href={next ? taskHref(next) : "/tasks"} className="glass glass-interactive flex min-h-16 items-center gap-4 rounded-2xl px-4 py-3">
      <ListTodo className="h-6 w-6 text-accent" />
      <div className="min-w-0">
        <div className="text-sm text-muted">
          {label || t("Tasks")}
          {" · "}
          {t("{n} open", { n: data.open })}
          {data.overdue > 0 && <span className="font-medium text-[var(--err)]"> · {t("{n} overdue", { n: data.overdue })}</span>}
        </div>
        {next ? (
          <div className="flex items-baseline gap-2">
            <span className="max-w-48 truncate font-semibold">{next.title}</span>
            <span className={`text-sm tabular-nums ${next.overdue ? "text-[var(--err)]" : "text-muted"}`}>{next.overdue ? t("Overdue") : next.due === localDay() ? t("today") : dateOnly(asLocal(next.due))}</span>
          </div>
        ) : (
          <div className="text-sm">{t("Nothing due soon.")}</div>
        )}
      </div>
    </Link>
  );
}
