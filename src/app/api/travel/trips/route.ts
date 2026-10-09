import { NextResponse } from "next/server";
import { createTrip, deleteTrip, updateTrip } from "@/lib/travel/store";
import { bad, body, guard } from "../_shared";

export const dynamic = "force-dynamic";

/** { title, start_date, end_date, stops: [{country, city?, lat?, lon?, arrive?, depart?}], companions: [userId], notes?, rating? } */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  try {
    return NextResponse.json(createTrip(g.user.id, await body(req)), { status: 201 });
  } catch (e) {
    return bad((e as Error).message);
  }
}

/** Same body plus { id }; only the owner may change a trip. */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  try {
    return NextResponse.json(updateTrip(g.user.id, Number(b.id), b));
  } catch (e) {
    return bad((e as Error).message, /Only the person/.test((e as Error).message) ? 403 : 400);
  }
}

/** ?id=: the owner deletes the trip, a companion leaves it. */
export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  return NextResponse.json(deleteTrip(g.user.id, Number(new URL(req.url).searchParams.get("id"))));
}
