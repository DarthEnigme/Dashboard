import { NextResponse } from "next/server";
import { addRule, deleteRule, listRules, matchRule, moveRule, uncategorizedMatches, updateRule } from "@/lib/finance/rules";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

const answer = (rules = listRules()) => NextResponse.json({ rules, pending: uncategorizedMatches(rules).length });

/** The rules in order, and how many uncategorised transactions they would fill. ?test=text: the rule that matches it. */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = new URL(req.url).searchParams;
  const test = q.get("test");
  if (test !== null) return NextResponse.json({ rule: matchRule(listRules(), test, q.get("account")) ?? null });
  return answer();
}

/** { match, mode?: contains|starts|equals|regex, category, account? } adds a rule (tried last). */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  try {
    return answer(addRule(((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>));
  } catch (e) {
    return bad((e as Error).message);
  }
}

/** { id, match, mode, category, account } edits; { id, move: "up" | "down" } reorders. */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const id = Number(b.id);
  if (!Number.isInteger(id)) return bad("id required");
  try {
    if (b.move === "up" || b.move === "down") return answer(moveRule(id, b.move));
    return answer(updateRule(id, b));
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return bad("id required");
  return answer(deleteRule(id));
}
