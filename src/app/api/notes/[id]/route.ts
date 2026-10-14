import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { deleteNote, getNote, updateNote } from "@/lib/notes/store";

export const dynamic = "force-dynamic";

const guard = (req?: Request) => guardPermission("notes", req, "notes");
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await guard();
  if ("error" in g) return g.error;
  const note = getNote(Number((await params).id));
  return note ? NextResponse.json(note) : NextResponse.json({ error: "No such note" }, { status: 404 });
}

/** { title, body, services? } */
export async function PUT(req: Request, { params }: Ctx) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number((await params).id);
  try {
    const note = updateNote(id, ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>, g.user.username);
    audit(g.user.username, "note-update", { id, title: note.title });
    return NextResponse.json(note);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number((await params).id);
  const note = getNote(id);
  if (!note) return NextResponse.json({ error: "No such note" }, { status: 404 });
  deleteNote(id);
  audit(g.user.username, "note-delete", { id, title: note.title });
  return NextResponse.json({ ok: true });
}
