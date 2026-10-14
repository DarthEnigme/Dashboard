import { db } from "../db";
import { findService, servicesOfType } from "../config/lookup";
import { httpJson, trimSlash } from "../http";
import { localDay } from "@/lib/day";
import { addItem, listItems, updateItem, type WatchItem } from "./store";

/**
 * Mark what you watched on Jellyfin or Plex in your watchlist. Each user links their own account on
 * one of the dashboard's Jellyfin/Plex widgets (whose admin key is used); a daily pass, or "Sync
 * now", finishes movies and shows found there, adding the ones missing. It never moves anything
 * back: a finished or dropped item stays as it is.
 */
export const MEDIA_TYPES = ["jellyfin", "plex"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface SyncSetup {
  service_id: string;
  media_user: string;
  last_sync: number | null;
  last_error: string | null;
}

/** One title seen on the media server. */
export interface Watched {
  kind: "movie" | "show";
  title: string;
  year: number | null;
  /** tmdb:…, imdb:…, jellyfin:… or plex:…, best first. */
  ids: string[];
  /** When it was last played (YYYY-MM-DD), if known. */
  date: string | null;
  /** Every episode played (shows); movies are always complete. */
  complete: boolean;
}

type Widget = { type: string; url?: string; key?: string; insecure?: boolean };

export function getSync(userId: number): SyncSetup | undefined {
  return db().prepare("SELECT service_id, media_user, last_sync, last_error FROM watch_sync WHERE owner_id = ?").get(userId) as SyncSetup | undefined;
}

export function setSync(userId: number, serviceId: string | null, mediaUser: string | null) {
  if (!serviceId || !mediaUser?.trim()) {
    db().prepare("DELETE FROM watch_sync WHERE owner_id = ?").run(userId);
    return;
  }
  db()
    .prepare("INSERT INTO watch_sync (owner_id, service_id, media_user) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET service_id = excluded.service_id, media_user = excluded.media_user, last_error = NULL")
    .run(userId, serviceId, mediaUser.trim().slice(0, 100));
}

const day = (d: string | number | undefined | null) => (d ? new Date(typeof d === "number" ? d * 1000 : d).toISOString().slice(0, 10) : null);
const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

// ---------- Jellyfin ----------

interface JfUser {
  Id: string;
  Name: string;
}
export interface JfItem {
  Id: string;
  Name: string;
  Type: "Movie" | "Series";
  ProductionYear?: number;
  ProviderIds?: Record<string, string>;
  UserData?: { Played?: boolean; LastPlayedDate?: string };
}

export function parseJellyfinPlayed(items: JfItem[]): Watched[] {
  return items.map((i) => {
    const p = i.ProviderIds ?? {};
    const ids = [p.Tmdb && `tmdb:${p.Tmdb}`, p.Imdb && `imdb:${p.Imdb}`, `jellyfin:${i.Id}`].filter((x): x is string => !!x);
    return { kind: i.Type === "Series" ? "show" : "movie", title: i.Name, year: i.ProductionYear ?? null, ids, date: day(i.UserData?.LastPlayedDate), complete: true };
  });
}

async function fromJellyfin(w: Widget, user: string): Promise<Watched[]> {
  const b = trimSlash(w.url!);
  const opts = { insecure: w.insecure, headers: { "X-Emby-Token": w.key! }, timeoutMs: 20_000 };
  const users = await httpJson<JfUser[]>(`${b}/Users`, opts);
  const u = users.find((x) => sameName(x.Name, user));
  if (!u) throw new Error(`No user "${user}" on this Jellyfin server`);
  const q = new URLSearchParams({ IsPlayed: "true", Recursive: "true", IncludeItemTypes: "Movie,Series", Fields: "ProviderIds,ProductionYear", EnableUserData: "true" });
  const r = await httpJson<{ Items: JfItem[] }>(`${b}/Users/${u.Id}/Items?${q}`, opts);
  return parseJellyfinPlayed(r.Items ?? []);
}

// ---------- Plex ----------

export interface PlexHistoryItem {
  type: "movie" | "episode" | string;
  title: string;
  grandparentTitle?: string;
  year?: number;
  ratingKey?: string;
  grandparentRatingKey?: string;
  viewedAt?: number;
}

/** Movies from the play history are finished; a show with episodes played is under way. */
export function parsePlexHistory(items: PlexHistoryItem[]): Watched[] {
  const out = new Map<string, Watched>();
  for (const i of items) {
    const show = i.type === "episode";
    if (!show && i.type !== "movie") continue;
    const title = show ? (i.grandparentTitle ?? i.title) : i.title;
    const key = `${show ? "show" : "movie"}|${title.toLowerCase()}`;
    const date = day(i.viewedAt);
    const prev = out.get(key);
    if (prev) {
      if (date && (!prev.date || date > prev.date)) prev.date = date;
      continue;
    }
    const rk = show ? i.grandparentRatingKey : i.ratingKey;
    out.set(key, { kind: show ? "show" : "movie", title, year: show ? null : (i.year ?? null), ids: rk ? [`plex:${rk}`] : [], date, complete: !show });
  }
  return [...out.values()];
}

async function fromPlex(w: Widget, user: string): Promise<Watched[]> {
  const b = trimSlash(w.url!);
  const opts = { insecure: w.insecure, headers: { "X-Plex-Token": w.key!, Accept: "application/json" }, timeoutMs: 20_000 };
  const accounts = await httpJson<{ MediaContainer: { Account?: { id: number; name: string }[] } }>(`${b}/accounts`, opts);
  const a = (accounts.MediaContainer.Account ?? []).find((x) => sameName(x.name, user));
  if (!a) throw new Error(`No account "${user}" on this Plex server`);
  const q = new URLSearchParams({ accountID: String(a.id), sort: "viewedAt:desc", "X-Plex-Container-Size": "5000" });
  const r = await httpJson<{ MediaContainer: { Metadata?: PlexHistoryItem[] } }>(`${b}/status/sessions/history/all?${q}`, opts);
  return parsePlexHistory(r.MediaContainer.Metadata ?? []);
}

// ---------- applying ----------

/** The item a watched title is: same id first, else same kind, title and (when both know it) year. */
export function findMatch(items: WatchItem[], w: Watched): WatchItem | undefined {
  const byId = items.find((i) => i.external_id && w.ids.includes(i.external_id));
  if (byId) return byId;
  return items.find(
    (i) => (i.kind === w.kind || i.kind === "other") && sameName(i.title.trim(), w.title.trim()) && (i.year === null || w.year === null || i.year === w.year),
  );
}

/** Finish (or start) what was watched, add what is missing. Never moves an item back. */
export function applyWatched(userId: number, watched: Watched[], today = localDay()): { added: number; updated: number } {
  let added = 0;
  let updated = 0;
  let items = listItems(userId);
  for (const w of watched) {
    const status = w.complete ? "done" : "active";
    const match = findMatch(items, w);
    if (!match) {
      items = addItem(userId, { kind: w.kind, title: w.title, year: w.year, external_id: w.ids[0], status, finished: w.complete ? (w.date ?? today) : undefined, tags: ["synced"] });
      added++;
      continue;
    }
    const rank = { planned: 0, active: 1, done: 2, dropped: 3 } as const;
    if (rank[status] <= rank[match.status]) continue;
    items = updateItem(userId, match.id, { status, ...(w.complete && w.date ? { finished: w.date } : {}) });
    updated++;
  }
  return { added, updated };
}

/** Services a user can link to: every Jellyfin and Plex widget (ids and names only). */
export async function mediaServices(): Promise<{ id: string; name: string; type: MediaType }[]> {
  return (await servicesOfType(MEDIA_TYPES)).map(({ id, service }) => ({ id, name: service.name, type: service.widget!.type as MediaType }));
}

/** Sync one user now; the outcome (or error) is remembered for the page. */
export async function syncUser(userId: number): Promise<{ added: number; updated: number }> {
  const setup = getSync(userId);
  if (!setup) throw new Error("Choose a Jellyfin or Plex server and your name there first");
  const done = (error: string | null) => db().prepare("UPDATE watch_sync SET last_sync = ?, last_error = ? WHERE owner_id = ?").run(Date.now(), error, userId);
  try {
    const w = (await findService(setup.service_id))?.widget as Widget | undefined;
    if (!w || !(MEDIA_TYPES as readonly string[]).includes(w.type) || !w.url || !w.key) throw new Error(`"${setup.service_id}" is not a Jellyfin or Plex widget any more`);
    const watched = w.type === "jellyfin" ? await fromJellyfin(w, setup.media_user) : await fromPlex(w, setup.media_user);
    const result = applyWatched(userId, watched);
    done(null);
    return result;
  } catch (e) {
    done((e as Error).message.slice(0, 300));
    throw e;
  }
}

/** Hourly: sync each linked user once a day. */
export async function watchSyncJob(now = Date.now()) {
  const due = db().prepare("SELECT owner_id FROM watch_sync WHERE last_sync IS NULL OR last_sync < ?").all(now - 23 * 3_600_000) as { owner_id: number }[];
  for (const { owner_id } of due) await syncUser(owner_id).catch((e) => console.warn(`[nanodash] watchlist sync for user ${owner_id} failed:`, (e as Error).message));
}
