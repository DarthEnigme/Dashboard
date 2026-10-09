import { db } from "../db";
import { COUNTRIES, countryIndex, UN_COUNT } from "./geo";

export const PLACE_STATUSES = ["visited", "lived", "want"] as const;
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

export interface Place {
  id: number;
  country: string;
  city: string | null;
  lat: number | null;
  lon: number | null;
  status: PlaceStatus;
  first_date: string | null;
}

export interface Stop {
  country: string;
  city: string | null;
  lat: number | null;
  lon: number | null;
  arrive: string | null;
  depart: string | null;
}

export interface Trip {
  id: number;
  owner_id: number;
  owner: string;
  title: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  rating: number | null;
  stops: Stop[];
  companions: { id: number; name: string }[];
  /** False when this person is a companion: they see it, the owner edits it. */
  mine: boolean;
}

export interface TravelStats {
  countries: number;
  /** UN members and observers: the usual "countries of the world". */
  of: number;
  continents: number;
  cities: number;
  /** Days away per year (trip days, by the year each day falls in). */
  daysByYear: { year: string; days: number }[];
  longest: { title: string; days: number } | null;
  trips: number;
}

const code = (c: unknown) => {
  const s = typeof c === "string" ? c.trim().toUpperCase() : "";
  if (countryIndex(s) < 0) throw new Error("Unknown country");
  return s;
};
const date = (d: unknown, what: string) => {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new Error(`${what} must be YYYY-MM-DD`);
  return d;
};
const optDate = (d: unknown, what: string) => (d === undefined || d === null || d === "" ? null : date(d, what));
const coord = (n: unknown, max: number) => (typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= max ? n : null);
const text = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);

// ---------- places ----------

export function listPlaces(userId: number): Place[] {
  return db().prepare("SELECT id, country, city, lat, lon, status, first_date FROM travel_places WHERE owner_id = ? ORDER BY country, city").all(userId) as unknown as Place[];
}

/** Mark a country (and optionally a city) as visited, lived in, or on the wish list; one row per country+city. */
export function savePlace(userId: number, p: Record<string, unknown>): Place[] {
  const country = code(p.country);
  const status = PLACE_STATUSES.includes(p.status as PlaceStatus) ? (p.status as PlaceStatus) : "visited";
  const city = text(p.city, 80);
  const existing = db()
    .prepare("SELECT id FROM travel_places WHERE owner_id = ? AND country = ? AND COALESCE(city, '') = COALESCE(?, '')")
    .get(userId, country, city) as { id: number } | undefined;
  const values = [status, coord(p.lat, 90), coord(p.lon, 180), optDate(p.first_date, "First visit")] as const;
  if (existing) db().prepare("UPDATE travel_places SET status = ?, lat = COALESCE(?, lat), lon = COALESCE(?, lon), first_date = COALESCE(?, first_date) WHERE id = ?").run(...values, existing.id);
  else db().prepare("INSERT INTO travel_places (owner_id, country, city, status, lat, lon, first_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(userId, country, city, ...values, Date.now());
  return listPlaces(userId);
}

export function deletePlace(userId: number, id: number): Place[] {
  db().prepare("DELETE FROM travel_places WHERE id = ? AND owner_id = ?").run(id, userId);
  return listPlaces(userId);
}

// ---------- trips ----------

/** Trips this person made or was taken along on, newest first. */
export function listTrips(userId: number): Trip[] {
  const rows = db()
    .prepare(
      `SELECT t.*, COALESCE(u.name, u.username) AS owner FROM travel_trips t JOIN users u ON u.id = t.owner_id
       WHERE t.owner_id = ? OR EXISTS (SELECT 1 FROM travel_companions c WHERE c.trip_id = t.id AND c.user_id = ?)
       ORDER BY t.start_date DESC, t.id DESC`,
    )
    .all(userId, userId) as unknown as Omit<Trip, "stops" | "companions" | "mine">[];
  const stops = db().prepare("SELECT country, city, lat, lon, arrive, depart FROM travel_stops WHERE trip_id = ? ORDER BY ord");
  const companions = db().prepare("SELECT u.id, COALESCE(u.name, u.username) AS name FROM travel_companions c JOIN users u ON u.id = c.user_id WHERE c.trip_id = ? ORDER BY name");
  return rows.map((r) => ({
    ...r,
    stops: stops.all(r.id) as unknown as Stop[],
    companions: companions.all(r.id) as unknown as Trip["companions"],
    mine: r.owner_id === userId,
  }));
}

function writeTrip(userId: number, id: number | null, b: Record<string, unknown>) {
  const title = text(b.title, 100);
  if (!title) throw new Error("Give the trip a name");
  const start = date(b.start_date, "Start");
  const end = date(b.end_date, "End");
  if (end < start) throw new Error("The trip ends before it starts");
  const rating = typeof b.rating === "number" && b.rating >= 1 && b.rating <= 5 ? Math.round(b.rating) : null;
  const stops = (Array.isArray(b.stops) ? b.stops : []).slice(0, 100).map((s: Record<string, unknown>) => ({
    country: code(s.country),
    city: text(s.city, 80),
    lat: coord(s.lat, 90),
    lon: coord(s.lon, 180),
    arrive: optDate(s.arrive, "Arrival"),
    depart: optDate(s.depart, "Departure"),
  }));
  const companionIds = [...new Set((Array.isArray(b.companions) ? b.companions : []).map(Number).filter((n) => Number.isInteger(n) && n !== userId))];
  db().exec("BEGIN");
  try {
    if (id === null) {
      id = Number(db().prepare("INSERT INTO travel_trips (owner_id, title, start_date, end_date, notes, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(userId, title, start, end, text(b.notes, 4000), rating, Date.now()).lastInsertRowid);
    } else {
      const own = db().prepare("SELECT 1 FROM travel_trips WHERE id = ? AND owner_id = ?").get(id, userId);
      if (!own) throw new Error("Only the person who added a trip can change it");
      db().prepare("UPDATE travel_trips SET title = ?, start_date = ?, end_date = ?, notes = ?, rating = ? WHERE id = ?").run(title, start, end, text(b.notes, 4000), rating, id);
      db().prepare("DELETE FROM travel_stops WHERE trip_id = ?").run(id);
      db().prepare("DELETE FROM travel_companions WHERE trip_id = ?").run(id);
    }
    const addStop = db().prepare("INSERT INTO travel_stops (trip_id, ord, country, city, lat, lon, arrive, depart) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    stops.forEach((s, i) => addStop.run(id, i, s.country, s.city, s.lat, s.lon, s.arrive, s.depart));
    const addCompanion = db().prepare("INSERT OR IGNORE INTO travel_companions (trip_id, user_id) SELECT ?, id FROM users WHERE id = ?");
    for (const c of companionIds) addCompanion.run(id, c);
    db().exec("COMMIT");
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
  return listTrips(userId);
}

export const createTrip = (userId: number, b: Record<string, unknown>) => writeTrip(userId, null, b);
export const updateTrip = (userId: number, id: number, b: Record<string, unknown>) => writeTrip(userId, id, b);

/** The owner deletes the trip; a companion only leaves it. */
export function deleteTrip(userId: number, id: number): Trip[] {
  const r = db().prepare("DELETE FROM travel_trips WHERE id = ? AND owner_id = ?").run(id, userId);
  if (!r.changes) db().prepare("DELETE FROM travel_companions WHERE trip_id = ? AND user_id = ?").run(id, userId);
  return listTrips(userId);
}

// ---------- what this person has seen ----------

/** Country codes visited (or lived in): marked places plus every stop of trips that have started. */
export function visitedCountries(places: Place[], trips: Trip[], today = new Date().toISOString().slice(0, 10)): Set<string> {
  const set = new Set(places.filter((p) => p.status !== "want").map((p) => p.country));
  for (const t of trips) if (t.start_date <= today) for (const s of t.stops) set.add(s.country);
  return set;
}

const dayMs = 86_400_000;

export function travelStats(places: Place[], trips: Trip[], today = new Date().toISOString().slice(0, 10)): TravelStats {
  const visited = visitedCountries(places, trips, today);
  const past = trips.filter((t) => t.start_date <= today);
  const cities = new Set([
    ...places.filter((p) => p.status !== "want" && p.city).map((p) => `${p.country}|${p.city!.toLowerCase()}`),
    ...past.flatMap((t) => t.stops.filter((s) => s.city).map((s) => `${s.country}|${s.city!.toLowerCase()}`)),
  ]);
  const days = new Map<string, number>();
  let longest: TravelStats["longest"] = null;
  for (const t of past) {
    const end = t.end_date < today ? t.end_date : today;
    const n = Math.round((Date.parse(end) - Date.parse(t.start_date)) / dayMs) + 1;
    if (!longest || n > longest.days) longest = { title: t.title, days: n };
    // Count each day in the year it falls in (a New Year trip counts in both years).
    for (let d = Date.parse(t.start_date); d <= Date.parse(end); d += dayMs) {
      const y = new Date(d).toISOString().slice(0, 4);
      days.set(y, (days.get(y) ?? 0) + 1);
    }
  }
  return {
    countries: [...visited].filter((c) => COUNTRIES[countryIndex(c)]?.un || c === "VA" || c === "PS").length,
    of: UN_COUNT,
    continents: new Set([...visited].map((c) => COUNTRIES[countryIndex(c)]?.continent).filter((c) => c && c !== "AN")).size,
    cities: cities.size,
    daysByYear: [...days].map(([year, d]) => ({ year, days: d })).sort((a, b) => b.year.localeCompare(a.year)),
    longest,
    trips: past.length,
  };
}
