import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The audit log, newest first: ?q= filters on user, action and detail; ?before= (ms) pages back. */
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const p = new URL(req.url).searchParams;
  const q = p.get("q")?.trim();
  const before = Number(p.get("before")) || Number.MAX_SAFE_INTEGER;
  const rows = db()
    .prepare(
      `SELECT ts, user, action, detail FROM audit WHERE ts < ? ${q ? "AND (user LIKE ? OR action LIKE ? OR detail LIKE ?)" : ""} ORDER BY ts DESC LIMIT 100`,
    )
    .all(...(q ? [before, `%${q}%`, `%${q}%`, `%${q}%`] : [before])) as { ts: number; user: string | null; action: string; detail: string | null }[];
  return NextResponse.json(rows);
}
