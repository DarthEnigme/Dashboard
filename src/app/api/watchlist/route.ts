import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/auth";
import { addItem, deleteItem, listItems, updateItem, watchStats } from "@/lib/watchlist/store";

export const dynamic = "force-dynamic";

const guard = (req?: Request) => guardPermission("watchlist", req, "the watchlist");
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
const reply = (items: ReturnType<typeof listItems>, status = 200) => NextResponse.json({ items, stats: watchStats(items) }, { status });

/** Your watchlist and reading list (private to you), with this year's stats. */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return reply(listItems(g.user.id));
}

/** { kind, title, creator?, year?, cover?, external_id?, total?, status? } */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  try {
    return reply(addItem(g.user.id, await body(req)), 201);
  } catch (e) {
    return bad((e as Error).message);
  }
}

/** { id, …fields to change } */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  try {
    return reply(updateItem(g.user.id, Number(b.id), b));
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  return reply(deleteItem(g.user.id, Number(new URL(req.url).searchParams.get("id"))));
}
