import { addTask, deleteTask, updateTask } from "@/lib/tasks/store";
import { partRoutes } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * POST { column, title, lane?, blocked_by?, body?, priority?, due?, labels? }.
 * PATCH { id, …fields to change, column?, lane?, index?, blocked_by? }: `column`, `lane` and `index` move the task.
 * DELETE ?id=.
 */
export const { POST, PATCH, DELETE } = partRoutes({ create: addTask, update: updateTask, remove: deleteTask });
