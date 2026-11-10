import { body } from "@/lib/api";
import { addTask, deleteTask, updateTask } from "@/lib/tasks/store";
import { change, guard } from "../_shared";

export const dynamic = "force-dynamic";

/** { column, title, body?, priority?, due?, labels? } */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return change(g.user.id, () => addTask(g.user.id, b), 201);
}

/** { id, …fields to change, column?, index? }: `column` and `index` move the task. */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return change(g.user.id, () => updateTask(g.user.id, b));
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  return change(g.user.id, () => deleteTask(g.user.id, id));
}
