import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listPlaces, listTrips, travelStats } from "@/lib/travel/store";
import { guard } from "./_shared";

export const dynamic = "force-dynamic";

/** Everything the travel page shows: places, trips (own and shared), stats, and who can be a companion. */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  const places = listPlaces(g.user.id);
  const trips = listTrips(g.user.id);
  const people = db()
    .prepare("SELECT id, COALESCE(name, username) AS name FROM users WHERE disabled = 0 AND id != ? ORDER BY name COLLATE NOCASE")
    .all(g.user.id) as { id: number; name: string }[];
  return NextResponse.json({ places, trips, stats: travelStats(places, trips), people });
}
