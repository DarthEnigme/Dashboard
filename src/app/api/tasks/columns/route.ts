import { addColumn, deleteColumn, updateColumn } from "@/lib/tasks/store";
import { partRoutes } from "../_shared";

export const dynamic = "force-dynamic";

/** POST { board, name }. PATCH { id, name?, done?, index? }. DELETE ?id=: only an empty column can go. */
export const { POST, PATCH, DELETE } = partRoutes({ create: addColumn, update: updateColumn, remove: deleteColumn });
