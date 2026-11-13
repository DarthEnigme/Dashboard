"use client";

import Link from "next/link";
import useSWR from "swr";
import { ListTodo, Plus } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { ServiceTask } from "@/lib/tasks/types";
import { taskHref } from "@/lib/tasks/links";
import { useT } from "@/i18n/client";
import { Checks, DueDate, PriorityDot } from "./TaskCard";

/**
 * Your open tasks about a service, on its page, and a way to add one. Nothing shows to someone
 * without the task boards (the request is refused).
 */
export function ServiceTasks({ serviceId }: { serviceId: string }) {
  const t = useT();
  const { data } = useSWR<ServiceTask[]>(`/api/tasks/for-service/${encodeURIComponent(serviceId)}`, fetcher, { shouldRetryOnError: false });
  if (!data) return null;
  const add = (
    <Link href={`/tasks?service=${encodeURIComponent(serviceId)}`} className="flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
      <Plus className="h-4 w-4" /> {t("New task about this service")}
    </Link>
  );
  if (!data.length) return add;
  return (
    <section className="glass flex flex-col gap-3 rounded-3xl p-5" aria-labelledby="service-tasks-title">
      <h2 id="service-tasks-title" className="flex items-center gap-2 text-sm font-semibold tracking-wider text-muted uppercase">
        <ListTodo className="h-4 w-4" /> {t("Tasks")}
      </h2>
      <ul className="flex flex-col gap-1">
        {data.map((task) => (
          <li key={task.id}>
            <Link href={taskHref({ id: task.id, board_id: task.board_id })} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-1.5 text-sm hover:bg-hover">
              <PriorityDot priority={task.priority} />
              <span className="min-w-0 flex-1 font-medium">{task.title}</span>
              <span className="flex items-center gap-3 text-xs text-muted">
                <Checks done={task.checked} total={task.checks} />
                <DueDate task={{ due: task.due, completed_at: null }} />
                <span>{task.board}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {add}
    </section>
  );
}
