import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { createGoal, deleteGoal, deleteGoalMove, listGoals, updateGoal } from "@/lib/finance/goals";
import { bad, guard, isDate } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(listGoals());
}

const targetCents = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
};

/** { name, target, deadline? } in the finance currency. */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const target = targetCents(b.target);
  if (typeof b.name !== "string" || !b.name.trim()) return bad("Name required");
  if (target === undefined) return bad("Target must be a positive amount");
  if (b.deadline && !isDate(b.deadline)) return bad("Deadline must be YYYY-MM-DD");
  createGoal({ name: b.name.trim().slice(0, 80), target, currency: loadConfig().settings.finance.currency, deadline: isDate(b.deadline) ? b.deadline : null });
  return NextResponse.json(listGoals(), { status: 201 });
}

/** { id, name?, target?, deadline? (null removes it) } */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (b.target !== undefined && targetCents(b.target) === undefined) return bad("Target must be a positive amount");
  if (b.deadline && !isDate(b.deadline)) return bad("Deadline must be YYYY-MM-DD");
  updateGoal(Number(b.id), {
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : undefined,
    target: b.target === undefined ? undefined : targetCents(b.target),
    deadline: b.deadline === undefined ? undefined : isDate(b.deadline) ? b.deadline : null,
  });
  return NextResponse.json(listGoals());
}

/** ?id= deletes a goal and its history; ?move= deletes one deposit or withdrawal. */
export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const q = new URL(req.url).searchParams;
  if (q.get("move")) deleteGoalMove(Number(q.get("move")));
  else deleteGoal(Number(q.get("id")));
  return NextResponse.json(listGoals());
}
