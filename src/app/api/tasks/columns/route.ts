import { body } from "@/lib/api";
import { addColumn, deleteColumn, updateColumn } from "@/lib/tasks/store";
import { change, guard } from "../_shared";

export const dynamic = "force-dynamic";

/** { board, name } */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return change(g.user.id, () => addColumn(g.user.id, b), 201);
}

/** { id, name?, done?, index? } */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return change(g.user.id, () => updateColumn(g.user.id, b));
}

/** ?id=: only an empty column can go. */
export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  return change(g.user.id, () => deleteColumn(g.user.id, id));
}
