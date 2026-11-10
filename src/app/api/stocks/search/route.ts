import { NextResponse } from "next/server";
import { bad } from "@/lib/api";
import { errorReason } from "@/lib/cache";
import { search } from "@/lib/stocks/service";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** ?q=: shares, funds and indexes matching a name or a symbol. */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return NextResponse.json([]);
  try {
    return NextResponse.json(await search(q));
  } catch (e) {
    return bad(`Yahoo Finance: ${errorReason(e)}`, 502);
  }
}
