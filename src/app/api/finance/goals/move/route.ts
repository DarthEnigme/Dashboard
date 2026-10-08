import { NextResponse } from "next/server";
import { listGoals, moveToGoal } from "@/lib/finance/goals";
import { bad, guard, isDate } from "../../_shared";

export const dynamic = "force-dynamic";

/** { id, amount (positive = put aside, negative = take out), date?, note? } */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount === 0) return bad("Amount must be a non-zero number");
  try {
    moveToGoal(
      Number(b.id),
      Math.round(amount * 100),
      isDate(b.date) ? b.date : new Date().toISOString().slice(0, 10),
      typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 200) : null,
    );
  } catch (e) {
    return bad((e as Error).message);
  }
  return NextResponse.json(listGoals(), { status: 201 });
}
