"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Board, Column, TasksData } from "@/lib/tasks/types";
import { useRemembered } from "@/lib/useRemembered";
import type { Cell } from "./cells";
import type { Naming, PartMove, TaskDraft } from "./model";
import { refreshTasksSummary } from "./useTasksSummary";

const BOARD_KEY = "page.tasks.board";
const PATHS = { board: "boards", column: "columns", lane: "lanes" } as const;
const boardUrl = (id?: number) => (id ? `/api/tasks?board=${id}` : "/api/tasks");

/**
 * One board and every change to it. The address says which board (`?board=`) and which task to open
 * (`?task=`), so a reminder's link and a click inside the page take the same path; without one, the
 * board of last time. Each change answers with the board as saved; moves show their result at once.
 * Changes made outside a dialog report failures in `problem`.
 */
export function useTaskBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const { mutate: mutateKey } = useSWRConfig();
  const [remembered, remember] = useRemembered(BOARD_KEY);
  const asked = Number(params.get("board")) || undefined;
  const boardId = asked ?? (Number(remembered) || undefined);
  // Without a board in the address, wait for the one of last time rather than load the first one too.
  const { data, mutate, error } = useSWR<TasksData>(asked || remembered !== undefined ? boardUrl(boardId) : null, fetcher, { keepPreviousData: true });
  const [failure, setFailure] = useState<string>();
  const board = data?.board;
  const columns = board?.columns ?? [];

  const go = (id: number, task?: number) => {
    remember(String(id));
    router.replace(`/tasks?board=${id}${task ? `&task=${task}` : ""}`, { scroll: false });
  };

  /** Run a change, keeping its failure for `problem` and the reminders bell up to date. */
  const attempt = async <T>(work: () => Promise<T>): Promise<T> => {
    setFailure(undefined);
    try {
      const out = await work();
      refreshTasksSummary();
      return out;
    } catch (e) {
      setFailure((e as Error).message);
      throw e;
    }
  };
  /** Send a change to this board; the answer is the board as saved. Meanwhile the page can already show `optimistic`. */
  const send = (path: string, method: string, body?: unknown, optimistic?: Partial<Board>) =>
    attempt(() =>
      mutate(sendJson<TasksData>(`/api/tasks/${path}`, method, body), {
        optimisticData: optimistic && data ? { ...data, board: { ...data.board, ...optimistic } } : undefined,
        rollbackOnError: true,
        revalidate: false,
      }),
    );
  /** Send a change that answers with another board (a new one, or the one left after a delete), and go there. */
  const sendAndGo = (path: string, method: string, body?: unknown) =>
    attempt(async () => {
      const next = await sendJson<TasksData>(`/api/tasks/${path}`, method, body);
      await mutateKey(boardUrl(next.board.id), next, { revalidate: false });
      go(next.board.id);
    });
  /** The same, for changes made outside a dialog: the failure shows above the board. */
  const quiet = (work: Promise<unknown>) => void work.catch(() => {});

  /** Move, delete or change a column or a lane from its menu. */
  const part = (kind: "columns" | "lanes", siblings: { id: number }[], id: number, change: PartMove | { collapsed: boolean }, optimistic?: Partial<Board>) => {
    if ("remove" in change) quiet(send(`${kind}?id=${id}`, "DELETE"));
    else if ("shift" in change) quiet(send(kind, "PATCH", { id, index: siblings.findIndex((x) => x.id === id) + change.shift }));
    else quiet(send(kind, "PATCH", { id, ...change }, optimistic));
  };

  return {
    data,
    board,
    columns,
    problem: failure ?? (error as Error | undefined)?.message,
    /** The task the address asks to open, until `opened` is called. */
    wantedTask: Number(params.get("task")) || undefined,
    /** A service the address asks to start a new task about (from that service's page), until `opened` is called. */
    wantedService: params.get("service") || undefined,
    opened: () => {
      if (board) go(board.id);
    },
    showBoard: (id: number) => go(id),

    saveTask: (d: TaskDraft) => send("items", d.id === undefined ? "POST" : "PATCH", d).then(() => {}),
    deleteTask: (id: number) => send(`items?id=${id}`, "DELETE").then(() => {}),
    addTask: (cell: Cell, title: string) => quiet(send("items", "POST", { column: cell.column, lane: cell.lane, title })),
    moveTask: (task: number, cell: Cell, index?: number, optimistic?: Column[]) =>
      quiet(send("items", "PATCH", { id: task, column: cell.column, lane: cell.lane, index }, optimistic && { columns: optimistic })),

    changeColumn: (id: number, change: PartMove) => part("columns", columns, id, change),
    changeLane: (id: number, change: PartMove | { collapsed: boolean }) =>
      part("lanes", board?.lanes ?? [], id, change, "collapsed" in change ? { lanes: board?.lanes.map((l) => (l.id === id ? { ...l, ...change } : l)) } : undefined),
    changeBoard: (patch: Partial<Pick<Board, "project" | "notify">>) => {
      if (board) quiet(send("boards", "PATCH", { id: board.id, ...patch }, patch));
    },

    /** What the name dialog starts with to rename a column or a lane. */
    renaming: (what: "column" | "lane", id: number): Naming | undefined => {
      const found = (what === "column" ? columns : (board?.lanes ?? [])).find((x) => x.id === id);
      return found && { what, id, name: found.name };
    },
    saveName: async (n: Naming) => {
      if (n.what === "board" && n.id === undefined) return sendAndGo("boards", "POST", { name: n.name });
      if (n.id !== undefined) await send(PATHS[n.what], "PATCH", { id: n.id, name: n.name });
      else if (board) await send(PATHS[n.what], "POST", { board: board.id, name: n.name });
    },
    deleteBoard: () => {
      if (board) quiet(sendAndGo(`boards?id=${board.id}`, "DELETE"));
    },
  };
}
