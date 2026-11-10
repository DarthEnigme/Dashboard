import { NextResponse } from "next/server";
import { bad, guardFor } from "@/lib/api";
import { getT } from "@/i18n/server";
import { loadBoard, type BoardNames } from "@/lib/tasks/store";

export const guard = guardFor("tasks", "the task boards");

/** What a first board and its columns are called, in the reader's language. */
async function names(): Promise<BoardNames> {
  const t = await getT();
  return { board: t("My board"), columns: [t("To do"), t("In progress"), t("Done")] };
}

/** The board as it is now: what every tasks route answers with. */
export const reply = async (userId: number, boardId?: number, status = 200) => NextResponse.json(loadBoard(userId, boardId, await names()), { status });

/** Run a change that returns the board it touched (and throws on bad input), then answer with that board. */
export async function change(userId: number, fn: (names: BoardNames) => number | undefined, status = 200) {
  let board: number | undefined;
  try {
    board = fn(await names());
  } catch (e) {
    return bad((e as Error).message);
  }
  return reply(userId, board, status);
}
