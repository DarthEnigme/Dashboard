import { db } from "../db";

/**
 * Notes and runbooks: Markdown pages, each linked to any number of services (by service id). A
 * note linked to a service shows on that service's page as its runbook, for everyone who can see
 * the service.
 */
export interface NoteSummary {
  id: number;
  title: string;
  updated_at: number;
  updated_by: string | null;
  services: string[];
}

export interface Note extends NoteSummary {
  body: string;
  created_at: number;
}

const MAX_BODY = 100_000;

const servicesOf = (id: number) => (db().prepare("SELECT service_id FROM note_services WHERE note_id = ? ORDER BY service_id").all(id) as { service_id: string }[]).map((r) => r.service_id);

/** Every note, last edited first; `q` searches titles and text. */
export function listNotes(q?: string): NoteSummary[] {
  const like = q?.trim() ? `%${q.trim()}%` : null;
  const rows = db()
    .prepare(`SELECT id, title, updated_at, updated_by FROM notes ${like ? "WHERE title LIKE ? OR body LIKE ?" : ""} ORDER BY updated_at DESC, id DESC`)
    .all(...(like ? [like, like] : [])) as unknown as Omit<NoteSummary, "services">[];
  return rows.map((r) => ({ ...r, services: servicesOf(r.id) }));
}

export function getNote(id: number): Note | undefined {
  const row = db().prepare("SELECT id, title, body, created_at, updated_at, updated_by FROM notes WHERE id = ?").get(id) as Omit<Note, "services"> | undefined;
  return row && { ...row, services: servicesOf(id) };
}

function clean(b: Record<string, unknown>) {
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) : "";
  if (!title) throw new Error("Title required");
  const body = typeof b.body === "string" ? b.body : "";
  if (body.length > MAX_BODY) throw new Error("A note can hold up to 100,000 characters");
  const services = Array.isArray(b.services) ? [...new Set(b.services.filter((s): s is string => typeof s === "string" && /^[\w.-]{1,200}$/.test(s)))].slice(0, 100) : undefined;
  return { title, body, services };
}

function link(id: number, services: string[]) {
  db().prepare("DELETE FROM note_services WHERE note_id = ?").run(id);
  const add = db().prepare("INSERT INTO note_services (note_id, service_id) VALUES (?, ?)");
  for (const s of services) add.run(id, s);
}

/** A new note: { title, body?, services? }. */
export function createNote(b: Record<string, unknown>, by: string | null): Note {
  const n = clean(b);
  const now = Date.now();
  const res = db().prepare("INSERT INTO notes (title, body, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)").run(n.title, n.body, now, now, by);
  const id = Number(res.lastInsertRowid);
  link(id, n.services ?? []);
  return getNote(id)!;
}

/** Change a note: services are replaced only when given. */
export function updateNote(id: number, b: Record<string, unknown>, by: string | null): Note {
  if (!getNote(id)) throw new Error("No such note");
  const n = clean(b);
  db().prepare("UPDATE notes SET title = ?, body = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(n.title, n.body, Date.now(), by, id);
  if (n.services) link(id, n.services);
  return getNote(id)!;
}

export function deleteNote(id: number) {
  db().prepare("DELETE FROM notes WHERE id = ?").run(id);
}

/** The runbooks of a service: notes linked to it, oldest first (the first one written leads). */
export function notesForService(serviceId: string): Pick<Note, "id" | "title" | "body" | "updated_at">[] {
  return db()
    .prepare("SELECT n.id, n.title, n.body, n.updated_at FROM notes n JOIN note_services s ON s.note_id = n.id WHERE s.service_id = ? ORDER BY n.created_at, n.id")
    .all(serviceId) as unknown as Pick<Note, "id" | "title" | "body" | "updated_at">[];
}
