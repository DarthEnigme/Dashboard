"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Board, Column, TasksData } from "@/lib/tasks/types";
import type { Cell } from "./cells";
import type { PartChange } from "./PartMenu";
import type { TaskDraft } from "./TaskDialog";
import { refreshTasksSummary } from "./useTasksSummary";

/** What the one-field dialog is naming (no id: a new one). */
export type Naming = { what: "board" | "column" | "lane"; id?: number; name: string };
/** A change made from a column's or a lane's menu (renaming goes through the dialog). */
export type PartMove = Exclude<PartChange, { rename: true }>;

const BOARD_KEY = "page.tasks.board";
export const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private windows: the choice just isn't kept
  }
};
export const recall = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * One board and every change to it. The address says which board (`?board=`) and which task to open
 * (`?task=`), so a reminder's link and a click inside the page take the same path; without one, the
 * board of last time. Each change answers with the board as saved; moves show their result at once.
 * Changes made outside a dialog report failures in `problem`.
 */
export function useTaskBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const [remembered, setRemembered] = useState<number>();
  useEffect(() => setRemembered(Number(recall(BOARD_KEY)) || undefined), []);
  const boardId = Number(params.get("board")) || remembered;

  const { data, mutate, error } = useSWR<TasksData>(boardId ? `/api/tasks?board=${boardId}` : "/api/tasks", fetcher, { keepPreviousData: true });
  const [failure, setFailure] = useState<string>();
  const board = data?.board;
  const columns = board?.columns ?? [];

  const go = (id: number, task?: number) => {
    remember(BOARD_KEY, String(id));
    router.replace(`/tasks?board=${id}${task ? `&task=${task}` : ""}`, { scroll: false });
  };

  /** Send a change; the answer is the board as saved. Meanwhile the page can already show `optimistic`. */
  const send = async (path: string, method: string, body?: unknown, optimistic?: Partial<Board>) => {
    setFailure(undefined);
    try {
      await mutate(sendJson<TasksData>(`/api/tasks/${path}`, method, body), {
        optimisticData: optimistic && data ? { ...data, board: { ...data.board, ...optimistic } } : undefined,
        rollbackOnError: true,
        revalidate: false,
      });
      refreshTasksSummary();
    } catch (e) {
      setFailure((e as Error).message);
      throw e;
    }
  };
  /** The same, for changes made outside a dialog: the failure shows above the board. */
  const quiet = (...args: Parameters<typeof send>) => void send(...args).catch(() => {});

  /** Move, delete or change a column or a lane from its menu. */
  const part = (kind: "columns" | "lanes", siblings: { id: number }[], id: number, change: PartMove | { collapsed: boolean }, optimistic?: Partial<Board>) => {
    if ("remove" in change) quiet(`${kind}?id=${id}`, "DELETE");
    else if ("shift" in change) quiet(kind, "PATCH", { id, index: siblings.findIndex((x) => x.id === id) + change.shift });
    else quiet(kind, "PATCH", { id, ...change }, optimistic);
  };

  return {
    data,
    board,
    columns,
    problem: failure ?? (error as Error | undefined)?.message,
    /** The task the address asks to open, until `opened` is called. */
    wantedTask: Number(params.get("task")) || undefined,
    opened: () => {
      if (board) go(board.id);
    },
    showBoard: (id: number) => go(id),

    saveTask: (d: TaskDraft) => send("items", d.id === undefined ? "POST" : "PATCH", d),
    deleteTask: (id: number) => send(`items?id=${id}`, "DELETE"),
    addTask: (cell: Cell, title: string) => quiet("items", "POST", { column: cell.column, lane: cell.lane, title }),
    moveTask: (task: number, cell: Cell, index?: number, optimistic?: Column[]) =>
      quiet("items", "PATCH", { id: task, column: cell.column, lane: cell.lane, index }, optimistic && { columns: optimistic }),

    changeColumn: (id: number, change: PartMove) => part("columns", columns, id, change),
    changeLane: (id: number, change: PartMove | { collapsed: boolean }) =>
      part("lanes", board?.lanes ?? [], id, change, "collapsed" in change ? { lanes: board?.lanes.map((l) => (l.id === id ? { ...l, ...change } : l)) } : undefined),
    changeBoard: (patch: Partial<Pick<Board, "project" | "notify">>) => {
      if (board) quiet("boards", "PATCH", { id: board.id, ...patch }, patch);
    },

    saveName: async (n: Naming) => {
      if (n.what === "board" && n.id === undefined) {
        // A new board answers with itself: go to it.
        go((await sendJson<TasksData>("/api/tasks/boards", "POST", { name: n.name })).board.id);
        return;
      }
      const kind = { board: "boards", column: "columns", lane: "lanes" }[n.what];
      await send(kind, n.id === undefined ? "POST" : "PATCH", n.id === undefined ? { board: board!.id, name: n.name } : { id: n.id, name: n.name });
    },
    deleteBoard: async () => {
      try {
        go((await sendJson<TasksData>(`/api/tasks/boards?id=${board!.id}`, "DELETE")).board.id);
      } catch (e) {
        setFailure((e as Error).message);
      }
    },
  };
}
