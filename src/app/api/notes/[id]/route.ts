import { NextResponse } from "next/server";
import { attempt, bad, body, guardFor } from "@/lib/api";
import { audit } from "@/lib/auth/users";
import { deleteNote, getNote, updateNote } from "@/lib/notes/store";

export const dynamic = "force-dynamic";

const guard = guardFor("notes", "notes");
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await guard();
  if ("error" in g) return g.error;
  const note = getNote(Number((await params).id));
  return note ? NextResponse.json(note) : bad("No such note", 404);
}

/** { title, body, services? } */
export async function PUT(req: Request, { params }: Ctx) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number((await params).id);
  const b = await body(req);
  return attempt(() => {
    const note = updateNote(id, b, g.user.username);
    audit(g.user.username, "note-update", { id, title: note.title });
    return note;
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number((await params).id);
  const note = getNote(id);
  if (!note) return bad("No such note", 404);
  deleteNote(id);
  audit(g.user.username, "note-delete", { id, title: note.title });
  return NextResponse.json({ ok: true });
}
