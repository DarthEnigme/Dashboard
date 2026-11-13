import { NextResponse } from "next/server";
import { crudRoutes, guardFor } from "@/lib/api";
import { getT } from "@/i18n/server";
import { hasAlertChannel } from "@/lib/alerts";
import { loadConfig } from "@/lib/config/load";
import { allServices } from "@/lib/config/lookup";
import { loadBoard, type BoardNames, type TasksData } from "@/lib/tasks/store";

export const guard = guardFor("tasks", "the task boards");

/** What a first board and its columns are called, in the reader's language. */
export async function names(): Promise<BoardNames> {
  const t = await getT();
  return { board: t("My board"), columns: [t("To do"), t("In progress"), t("Done")] };
}

/** The board as it is now, and whether reminders can go anywhere: what every tasks route answers with. */
export const board = async (userId: number, boardId?: number): Promise<TasksData> => ({
  ...loadBoard(userId, boardId, await names()),
  alerts: hasAlertChannel(loadConfig().settings.alerts),
  services: (await allServices()).map((s) => ({ id: s.id, name: s.service.name, group: s.group })),
});
export const reply = async (userId: number, boardId?: number) => NextResponse.json(await board(userId, boardId));

/** The handlers of a part of a board (a column, a lane, a task): each answers with the board it touched. */
export const partRoutes = (store: Parameters<typeof crudRoutes<number>>[1]) => crudRoutes(guard, store, board);
