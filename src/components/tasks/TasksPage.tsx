"use client";

import { useState } from "react";
import { Plus, Rows3 } from "lucide-react";
import type { Task } from "@/lib/tasks/types";
import { oneOf } from "@/lib/clean";
import { useRemembered } from "@/lib/useRemembered";
import { useT } from "@/i18n/client";
import { AppHeader } from "../AppHeader";
import { Board } from "./Board";
import { ListView } from "./ListView";
import { NameDialog } from "./NameDialog";
import { Reminders } from "./Reminders";
import { TaskDialog } from "./TaskDialog";
import { Toolbar, VIEW_IDS, viewsFor, type View } from "./Toolbar";
import { applyFilter, filtering, overdue, type Filter } from "./meta";
import type { Naming, NewTask } from "./model";
import { useTaskBoard } from "./useTaskBoard";
import { Progress, WorkflowView } from "./WorkflowView";

const VIEW_KEY = "page.tasks.view";

/** Task boards: a kanban view to move work along, a list to sort and scan it, and a project's steps. */
export function TasksPage() {
  const t = useT();
  const tasks = useTaskBoard();
  const { data, board, columns } = tasks;
  const [savedView, showView] = useRemembered(VIEW_KEY);
  const view = oneOf<View>(savedView, VIEW_IDS, "board");
  const [filter, setFilter] = useState<Filter>({ text: "" });
  const [open, setOpen] = useState<Task | NewTask>();
  const [naming, setNaming] = useState<Naming>();

  const shown = applyFilter(columns, filter);
  const all = columns.flatMap((c) => c.tasks);
  const openCount = all.filter((x) => x.completed_at === null).length;
  const late = all.filter(overdue).length;
  // The task the address asks for (a reminder's link) is open once its board has loaded.
  // From a service's page: a new task about it, in the first open column.
  const firstOpen = columns.find((c) => !c.done) ?? columns[0];
  const forService: NewTask | undefined = tasks.wantedService && firstOpen ? { column_id: firstOpen.id, lane_id: null, service: tasks.wantedService } : undefined;
  const dialog = open ?? all.find((x) => x.id === tasks.wantedTask) ?? forService;
  const closeDialog = () => {
    setOpen(undefined);
    if (tasks.wantedTask || tasks.wantedService) tasks.opened();
  };
  // A view the board doesn't have (the workflow, out of project mode) falls back to the board.
  const current = board && viewsFor(board).includes(view) ? view : "board";

  const showBoard = (id: number) => {
    tasks.showBoard(id);
    setFilter({ text: "" });
  };

  return (
    <main className="mx-auto flex max-w-[100rem] flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <AppHeader
        title={t("Tasks")}
        subtitle={
          board ? (
            <>
              {t.plural(openCount, "{n} open task", "{n} open tasks")}
              {late > 0 && <span className="text-[var(--err)]"> · {t("{n} overdue", { n: late })}</span>}
            </>
          ) : undefined
        }
      >
        <Reminders />
        {board && (
          <button type="button" onClick={() => setOpen({ column_id: columns[0]?.id ?? 0, lane_id: null })} disabled={!columns.length} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">
            <Plus className="h-4 w-4" /> {t("New task")}
          </button>
        )}
      </AppHeader>

      {tasks.problem && (
        <p role="alert" className="rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">
          {tasks.problem}
        </p>
      )}

      {data && board && (
        <>
          <Toolbar data={data} filter={filter} onFilter={setFilter} view={current} onView={showView} onBoard={showBoard} onName={setNaming} onChangeBoard={tasks.changeBoard} onDeleteBoard={tasks.deleteBoard} />
          {board.project && <Progress columns={columns} />}

          {current === "board" && (
            <>
              {filtering(filter) && <p className="text-xs text-muted">{t("Clear the filter to drag tasks: only some of them are showing.")}</p>}
              <Board
                columns={shown}
                lanes={board.lanes}
                canMove={!filtering(filter)}
                onOpen={setOpen}
                onAdd={tasks.addTask}
                onMove={tasks.moveTask}
                onColumn={(id, change) => ("rename" in change ? setNaming(tasks.renaming("column", id)) : tasks.changeColumn(id, change))}
                onLane={(id, change) => ("rename" in change ? setNaming(tasks.renaming("lane", id)) : tasks.changeLane(id, change))}
              />
              <div className="flex flex-wrap gap-1">
                <button type="button" onClick={() => setNaming({ what: "column", name: "" })} className="flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
                  <Plus className="h-4 w-4" /> {t("Add column")}
                </button>
                <button type="button" onClick={() => setNaming({ what: "lane", name: "" })} className="flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
                  <Rows3 className="h-4 w-4" /> {t("Add lane")}
                </button>
              </div>
            </>
          )}
          {current === "list" && <ListView columns={shown} lanes={board.lanes} onOpen={setOpen} onMove={(task, column) => tasks.moveTask(task.id, { column, lane: task.lane_id }, undefined)} />}
          {current === "workflow" && <WorkflowView columns={shown} onOpen={setOpen} />}
        </>
      )}

      {dialog && board && <TaskDialog task={dialog} board={board} labels={data?.labels ?? []} services={data?.services ?? []} onSave={tasks.saveTask} onDelete={tasks.deleteTask} onClose={closeDialog} />}
      {naming && <NameDialog naming={naming} onSave={tasks.saveName} onClose={() => setNaming(undefined)} />}
    </main>
  );
}
