import { createBoard, deleteBoard, updateBoard } from "@/lib/tasks/store";
import { names, partRoutes } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * POST { name }: a new board with the three usual columns (the answer shows it).
 * PATCH { id, name?, project?, notify? }.
 * DELETE ?id=: the board goes with its lanes, columns and tasks; the answer shows another board.
 */
export const { POST, PATCH, DELETE } = partRoutes({ create: async (u, b) => createBoard(u, b, await names()), update: updateBoard, remove: deleteBoard });
