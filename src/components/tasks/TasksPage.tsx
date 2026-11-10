"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Columns3, List, Pencil, Plus, Search } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { PRIORITIES, type Column, type Priority, type Task, type TasksData } from "@/lib/tasks/types";
import { useT } from "@/i18n/client";
import { AppHeader } from "../AppHeader";
import { Dialog } from "../edit/Dialog";
import { DeleteButton, IconButton } from "../edit/controls";
import { inputBase, inputClass } from "../edit/FieldInput";
import { Board } from "./Board";
import type { ColumnChange } from "./ColumnMenu";
import { ListView } from "./ListView";
import { TaskDialog, type TaskDraft } from "./TaskDialog";
import { applyFilter, filtering, overdue, PRIORITY_LABELS, type Filter } from "./meta";

type View = "board" | "list";
/** What the one-field dialog is naming. */
type Naming = { what: "board" | "column"; id?: number; name: string };

const VIEW_KEY = "page.tasks.view";
const BOARD_KEY = "page.tasks.board";
const remember = (key: string, value: string | undefined) => {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private windows: the choice just isn't kept
  }
};

/** Task boards: a kanban view to move work along, and a list view to sort and scan it. */
export function TasksPage() {
  const t = useT();
  const [boardId, setBoardId] = useState<number>();
  const [view, setView] = useState<View>("board");
  const { data, mutate, error } = useSWR<TasksData>(boardId ? `/api/tasks?board=${boardId}` : "/api/tasks", fetcher, { keepPreviousData: true });
  const [failure, setFailure] = useState<string>();
  const [filter, setFilter] = useState<Filter>({ text: "" });
  const [open, setOpen] = useState<Task | { column_id: number }>();
  const [naming, setNaming] = useState<Naming>();

  // Back on the board and view of last time.
  useEffect(() => {
    try {
      const board = Number(localStorage.getItem(BOARD_KEY));
      if (board) setBoardId(board);
      if (localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {
      // nothing remembered
    }
  }, []);

  const board = data?.board;
  const columns = board?.columns ?? [];
  const shown = applyFilter(columns, filter);
  const tasks = columns.flatMap((c) => c.tasks);
  const openCount = tasks.filter((x) => x.completed_at === null).length;
  const late = tasks.filter(overdue).length;

  const showBoard = (id: number | undefined) => {
    setBoardId(id);
    remember(BOARD_KEY, id === undefined ? undefined : String(id));
    setFilter({ text: "" });
  };
  const showView = (v: View) => {
    setView(v);
    remember(VIEW_KEY, v);
  };

  /** Send a change; the answer is the board as saved. Meanwhile the page can already show `optimistic`. */
  const send = async (path: string, method: string, body?: unknown, optimistic?: Column[]) => {
    setFailure(undefined);
    try {
      await mutate(sendJson<TasksData>(`/api/tasks/${path}`, method, body), {
        optimisticData: optimistic && data ? { ...data, board: { ...data.board, columns: optimistic } } : undefined,
        rollbackOnError: true,
        revalidate: false,
      });
    } catch (e) {
      setFailure((e as Error).message);
      throw e;
    }
  };
  /** The same, for changes made outside a dialog: the failure shows above the board. */
  const quiet = (...args: Parameters<typeof send>) => void send(...args).catch(() => {});

  const saveTask = (d: TaskDraft) => (d.id === undefined ? send("items", "POST", d) : send("items", "PATCH", { ...d, column: columns.some((c) => c.id === d.column && c.tasks.some((x) => x.id === d.id)) ? undefined : d.column }));

  const changeColumn = (id: number, change: ColumnChange) => {
    const at = columns.findIndex((c) => c.id === id);
    if ("rename" in change) setNaming({ what: "column", id, name: columns[at].name });
    else if ("done" in change) quiet("columns", "PATCH", { id, done: change.done });
    else if ("shift" in change) quiet("columns", "PATCH", { id, index: at + change.shift });
    else quiet(`columns?id=${id}`, "DELETE");
  };

  const saveName = async (n: Naming) => {
    if (n.what === "column") return send("columns", n.id === undefined ? "POST" : "PATCH", n.id === undefined ? { board: board!.id, name: n.name } : { id: n.id, name: n.name });
    if (n.id !== undefined) return send("boards", "PATCH", { id: n.id, name: n.name });
    // A new board answers with itself: go to it.
    showBoard((await sendJson<TasksData>("/api/tasks/boards", "POST", { name: n.name })).board.id);
  };

  const deleteBoard = async () => {
    try {
      const next = await sendJson<TasksData>(`/api/tasks/boards?id=${board!.id}`, "DELETE");
      showBoard(next.board.id);
    } catch (e) {
      setFailure((e as Error).message);
    }
  };

  const problem = failure ?? (error as Error | undefined)?.message;

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
        {board && (
          <button type="button" onClick={() => setOpen({ column_id: columns[0]?.id ?? 0 })} disabled={!columns.length} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50">
            <Plus className="h-4 w-4" /> {t("New task")}
          </button>
        )}
      </AppHeader>

      {problem && (
        <p role="alert" className="rounded-xl bg-[var(--err)]/15 px-3 py-2 text-sm text-[var(--err)]">
          {problem}
        </p>
      )}

      {data && board && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={board.id} onChange={(e) => showBoard(Number(e.target.value))} aria-label={t("Board")} className={`${inputBase} w-48 font-medium`}>
              {data.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <IconButton label="Rename board" onClick={() => setNaming({ what: "board", id: board.id, name: board.name })}>
              <Pencil className="h-4 w-4" />
            </IconButton>
            <IconButton label="New board" onClick={() => setNaming({ what: "board", name: "" })}>
              <Plus className="h-4 w-4" />
            </IconButton>
            {data.boards.length > 1 && <DeleteButton label={t("Delete board")} onConfirm={deleteBoard} />}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
                <input type="search" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} placeholder={t("Filter tasks…")} aria-label={t("Filter tasks…")} className={`${inputBase} w-44 pl-9`} />
              </label>
              {data.labels.length > 0 && (
                <select value={filter.label ?? ""} onChange={(e) => setFilter({ ...filter, label: e.target.value || undefined })} aria-label={t("Label")} className={`${inputBase} w-36`}>
                  <option value="">{t("All labels")}</option>
                  {data.labels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={filter.priority ?? ""}
                onChange={(e) => setFilter({ ...filter, priority: e.target.value === "" ? undefined : (Number(e.target.value) as Priority) })}
                aria-label={t("Priority")}
                className={`${inputBase} w-36`}
              >
                <option value="">{t("Any priority")}</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(PRIORITY_LABELS[p])}
                  </option>
                ))}
              </select>
              <div className="glass flex rounded-full p-1" role="group" aria-label={t("View")}>
                {(
                  [
                    ["board", Columns3, t("Board")],
                    ["list", List, t("List")],
                  ] as const
                ).map(([v, Icon, label]) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => showView(v)} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-muted hover:text-fg aria-pressed:bg-accent aria-pressed:text-white">
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {view === "board" ? (
            <>
              {filtering(filter) && <p className="text-xs text-muted">{t("Clear the filter to drag tasks: only some of them are showing.")}</p>}
              <Board
                columns={shown}
                canMove={!filtering(filter)}
                onOpen={setOpen}
                onAdd={(column, title) => quiet("items", "POST", { column, title })}
                onMove={(task, column, index, optimistic) => quiet("items", "PATCH", { id: task, column, index }, optimistic)}
                onColumn={changeColumn}
              />
              <button type="button" onClick={() => setNaming({ what: "column", name: "" })} className="flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
                <Plus className="h-4 w-4" /> {t("Add column")}
              </button>
            </>
          ) : (
            <ListView columns={shown} onOpen={setOpen} onMove={(task, column) => quiet("items", "PATCH", { id: task, column })} />
          )}
        </>
      )}

      {open && <TaskDialog task={open} columns={columns} labels={data?.labels ?? []} onSave={saveTask} onDelete={(id) => send(`items?id=${id}`, "DELETE")} onClose={() => setOpen(undefined)} />}
      {naming && <NameDialog naming={naming} onSave={saveName} onClose={() => setNaming(undefined)} />}
    </main>
  );
}

function NameDialog({ naming, onSave, onClose }: { naming: Naming; onSave: (n: Naming) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(naming.name);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const title = naming.what === "board" ? (naming.id === undefined ? t("New board") : t("Rename board")) : naming.id === undefined ? t("New column") : t("Rename column");

  const submit = async () => {
    setBusy(true);
    try {
      await onSave({ ...naming, name });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={title} onClose={onClose} onSubmit={submit} error={error} busy={busy}>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
        {t("Name")}
        <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
    </Dialog>
  );
}
