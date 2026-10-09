import { NextResponse } from "next/server";
import { deletePlace, savePlace } from "@/lib/travel/store";
import { bad, body, guard } from "../_shared";

export const dynamic = "force-dynamic";

/** { country, city?, lat?, lon?, status: visited|lived|want, first_date? }: adds or updates that place. */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  try {
    return NextResponse.json(savePlace(g.user.id, await body(req)));
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  return NextResponse.json(deletePlace(g.user.id, Number(new URL(req.url).searchParams.get("id"))));
}
