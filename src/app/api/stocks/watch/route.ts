import { NextResponse } from "next/server";
import { attempt, body } from "@/lib/api";
import { loadWatchlist } from "@/lib/stocks/service";
import { unwatch, watch } from "@/lib/stocks/store";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** The symbols you watch, each with its price, today's change and its last weeks. */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(await loadWatchlist(g.user.id));
}

/** { symbol } */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  return attempt(() => {
    watch(g.user.id, String(b.symbol ?? ""));
    return { ok: true };
  }, 201);
}

/** ?symbol= */
export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  unwatch(g.user.id, new URL(req.url).searchParams.get("symbol") ?? "");
  return NextResponse.json({ ok: true });
}
