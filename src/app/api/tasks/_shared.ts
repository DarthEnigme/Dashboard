import { NextResponse } from "next/server";
import { crudRoutes, guardFor } from "@/lib/api";
import { getT } from "@/i18n/server";
import { hasAlertChannel } from "@/lib/alerts";
import { loadConfig } from "@/lib/config/load";
import { loadBoard, type BoardNames } from "@/lib/tasks/store";

export const guard = guardFor("tasks", "the task boards");

/** What a first board and its columns are called, in the reader's language. */
export async function names(): Promise<BoardNames> {
  const t = await getT();
  return { board: t("My board"), columns: [t("To do"), t("In progress"), t("Done")] };
}

/** The board as it is now, and whether reminders can go anywhere: what every tasks route answers with. */
const board = async (userId: number, boardId?: number) => ({ ...loadBoard(userId, boardId, await names()), alerts: hasAlertChannel(loadConfig().settings.alerts) });
export const reply = async (userId: number, boardId?: number) => NextResponse.json(await board(userId, boardId));

type Change<A> = (userId: number, arg: A, names: BoardNames) => number | undefined;

/** The handlers of a part of a board (the board itself, a column, a lane, a task): each answers with the board it touched. */
export const partRoutes = (store: { create: Change<Record<string, unknown>>; update: Change<Record<string, unknown>>; remove: Change<number> }) =>
  crudRoutes(
    guard,
    {
      create: async (u, b) => store.create(u, b, await names()),
      update: async (u, b) => store.update(u, b, await names()),
      remove: async (u, id) => store.remove(u, id, await names()),
    },
    board,
  );
