"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { taskHref } from "@/lib/tasks/links";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { asLocal } from "@/lib/day";
import { Menu, menuItem } from "../edit/Menu";
import { useTasksSummary } from "./useTasksSummary";

/** A bell with the tasks that are overdue or due soon, on every board: each one links to it, opened. */
export function Reminders() {
  const t = useT();
  const { data } = useTasksSummary();
  const due = data?.due ?? [];
  return (
    <Menu
      label={t("Reminders")}
      width="w-80"
      className="relative rounded-full p-2 text-muted hover:bg-hover hover:text-fg"
      button={
        <>
          <Bell className="h-5 w-5" />
          {due.length > 0 && (
            <span className={`absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-white ${data!.overdue ? "bg-[var(--err)]" : "bg-accent"}`}>{due.length}</span>
          )}
        </>
      }
    >
      {(close) =>
        due.length ? (
          due.map((d) => (
            <Link key={d.id} href={taskHref(d)} scroll={false} role="menuitem" className={`${menuItem} justify-between`} onClick={close}>
              <span className="min-w-0">
                <span className="block truncate">{d.title}</span>
                <span className="block truncate text-xs text-muted">{d.board}</span>
              </span>
              <span className={`shrink-0 text-xs ${d.overdue ? "font-medium text-[var(--err)]" : "text-muted"}`}>{d.overdue ? t("Overdue") : dateOnly(asLocal(d.due))}</span>
            </Link>
          ))
        ) : (
          <p className="px-2 py-3 text-center text-sm text-muted">{t("Nothing due soon.")}</p>
        )
      }
    </Menu>
  );
}
