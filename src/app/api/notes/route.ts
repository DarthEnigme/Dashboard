import { NextResponse } from "next/server";
import { attempt, body, guardFor } from "@/lib/api";
import { audit } from "@/lib/auth/users";
import { allServices } from "@/lib/config/lookup";
import { createNote, listNotes } from "@/lib/notes/store";

export const dynamic = "force-dynamic";

const guard = guardFor("notes", "notes");

/** Every note (?q= searches), and the services they can link to (ids, names and groups only). */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  const services = (await allServices()).map((s) => ({ id: s.id, name: s.service.name, group: s.group }));
  return NextResponse.json({ notes: listNotes(q), services });
}

/** { title, body?, services?: service ids } */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return attempt(() => {
    const note = createNote(b, g.user.username);
    audit(g.user.username, "note-create", { id: note.id, title: note.title });
    return note;
  }, 201);
}
