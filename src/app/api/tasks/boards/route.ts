import { body } from "@/lib/api";
import { createBoard, deleteBoard, renameBoard } from "@/lib/tasks/store";
import { change, guard } from "../_shared";

export const dynamic = "force-dynamic";

/** { name }: a new board with the three usual columns. */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return change(g.user.id, (names) => createBoard(g.user.id, b, names), 201);
}

/** { id, name } */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return change(g.user.id, () => {
    renameBoard(g.user.id, Number(b.id), b);
    return Number(b.id);
  });
}

/** ?id=: the board goes with its columns and tasks; the answer shows another board. */
export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  return change(g.user.id, () => {
    deleteBoard(g.user.id, id);
    return undefined;
  });
}
