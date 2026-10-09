import { db } from "../db";

export const WATCH_KINDS = ["book", "movie", "show", "game", "other"] as const;
export const WATCH_STATUSES = ["planned", "active", "done", "dropped"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];
export type WatchStatus = (typeof WATCH_STATUSES)[number];

export interface WatchItem {
  id: number;
  kind: WatchKind;
  title: string;
  creator: string | null;
  year: number | null;
  cover: string | null;
  external_id: string | null;
  status: WatchStatus;
  rating: number | null;
  /** Pages read, episodes watched… out of `total`. */
  progress: number | null;
  total: number | null;
  started: string | null;
  finished: string | null;
  notes: string | null;
}

export interface WatchStats {
  year: string;
  /** Finished this year, per kind. */
  done: Partial<Record<WatchKind, number>>;
  /** Pages of the books finished this year. */
  pages: number;
  active: number;
  planned: number;
}

const today = () => new Date().toISOString().slice(0, 10);
const text = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);
const int = (n: unknown, min: number, max: number) => {
  const v = typeof n === "string" && n.trim() !== "" ? Number(n) : n;
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
};
const day = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
/** Covers come from Open Library, or any http(s) image the person gives. */
const coverUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\/\S+$/.test(u) ? u.slice(0, 500) : null);

export function listItems(userId: number): WatchItem[] {
  return db()
    .prepare(
      `SELECT id, kind, title, creator, year, cover, external_id, status, rating, progress, total, started, finished, notes FROM watch_items
       WHERE owner_id = ?
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, COALESCE(finished, '') DESC, created_at DESC`,
    )
    .all(userId) as unknown as WatchItem[];
}

export function addItem(userId: number, b: Record<string, unknown>): WatchItem[] {
  const title = text(b.title, 200);
  if (!title) throw new Error("Title required");
  const kind = WATCH_KINDS.includes(b.kind as WatchKind) ? (b.kind as WatchKind) : "other";
  const status = WATCH_STATUSES.includes(b.status as WatchStatus) ? (b.status as WatchStatus) : "planned";
  db()
    .prepare(
      `INSERT INTO watch_items (owner_id, kind, title, creator, year, cover, external_id, status, total, started, finished, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      kind,
      title,
      text(b.creator, 200),
      int(b.year, -3000, 3000),
      coverUrl(b.cover),
      text(b.external_id, 100),
      status,
      int(b.total, 1, 100_000),
      status === "active" || status === "done" ? today() : null,
      status === "done" ? today() : null,
      Date.now(),
    );
  return listItems(userId);
}

/**
 * Change an item. Moving it to "active" starts it today (if it hadn't started), to "done" finishes
 * it today and fills the progress; going back to "planned" clears both dates.
 */
export function updateItem(userId: number, id: number, b: Record<string, unknown>): WatchItem[] {
  const cur = db().prepare("SELECT * FROM watch_items WHERE id = ? AND owner_id = ?").get(id, userId) as WatchItem | undefined;
  if (!cur) throw new Error("No such item");
  const next: WatchItem = { ...cur };
  if (b.title !== undefined) next.title = text(b.title, 200) ?? cur.title;
  if (b.creator !== undefined) next.creator = text(b.creator, 200);
  if (b.kind !== undefined && WATCH_KINDS.includes(b.kind as WatchKind)) next.kind = b.kind as WatchKind;
  if (b.year !== undefined) next.year = int(b.year, -3000, 3000);
  if (b.cover !== undefined) next.cover = coverUrl(b.cover);
  if (b.rating !== undefined) next.rating = int(b.rating, 1, 5);
  if (b.total !== undefined) next.total = int(b.total, 1, 100_000);
  if (b.progress !== undefined) next.progress = int(b.progress, 0, 100_000);
  if (b.notes !== undefined) next.notes = text(b.notes, 4000);
  if (b.started !== undefined) next.started = day(b.started);
  if (b.finished !== undefined) next.finished = day(b.finished);
  if (b.status !== undefined && WATCH_STATUSES.includes(b.status as WatchStatus) && b.status !== cur.status) {
    next.status = b.status as WatchStatus;
    if (next.status === "active") next.started ??= today();
    if (next.status === "done") {
      next.started ??= today();
      next.finished = day(b.finished) ?? today();
      if (next.total) next.progress = next.total;
    }
    if (next.status === "planned") next.started = next.finished = null;
  }
  if (next.total !== null && next.progress !== null && next.progress > next.total) next.progress = next.total;
  db()
    .prepare("UPDATE watch_items SET kind = ?, title = ?, creator = ?, year = ?, cover = ?, status = ?, rating = ?, progress = ?, total = ?, started = ?, finished = ?, notes = ? WHERE id = ?")
    .run(next.kind, next.title, next.creator, next.year, next.cover, next.status, next.rating, next.progress, next.total, next.started, next.finished, next.notes, id);
  return listItems(userId);
}

export function deleteItem(userId: number, id: number): WatchItem[] {
  db().prepare("DELETE FROM watch_items WHERE id = ? AND owner_id = ?").run(id, userId);
  return listItems(userId);
}

export function watchStats(items: WatchItem[], year = today().slice(0, 4)): WatchStats {
  const done: WatchStats["done"] = {};
  let pages = 0;
  for (const i of items) {
    if (i.status !== "done" || !i.finished?.startsWith(year)) continue;
    done[i.kind] = (done[i.kind] ?? 0) + 1;
    if (i.kind === "book") pages += i.total ?? 0;
  }
  return { year, done, pages, active: items.filter((i) => i.status === "active").length, planned: items.filter((i) => i.status === "planned").length };
}

// ---------- Open Library ----------

export interface BookHit {
  title: string;
  author: string | null;
  year: number | null;
  pages: number | null;
  cover: string | null;
  key: string;
}

interface OlDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  number_of_pages_median?: number;
  cover_i?: number;
}

/** Search results as Page uses them; `covers` is the Open Library covers host. */
export function parseOpenLibrary(r: { docs?: OlDoc[] }, covers = "https://covers.openlibrary.org"): BookHit[] {
  return (r.docs ?? []).slice(0, 10).map((d) => ({
    title: d.title,
    author: d.author_name?.slice(0, 2).join(", ") ?? null,
    year: d.first_publish_year ?? null,
    pages: d.number_of_pages_median ?? null,
    cover: d.cover_i ? `${covers}/b/id/${d.cover_i}-M.jpg` : null,
    key: d.key,
  }));
}
