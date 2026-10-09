import { NextResponse } from "next/server";
import { transfer } from "@/lib/finance/accounts";
import { bad, guard, isDate } from "../_shared";

export const dynamic = "force-dynamic";

/** { from, to (account ids), date, amount, toAmount? (other currency), note? } */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (!isDate(b.date)) return bad("Date must be YYYY-MM-DD");
  const amount = Number(b.amount);
  const toAmount = b.toAmount === undefined || b.toAmount === "" ? undefined : Number(b.toAmount);
  try {
    const id = transfer({
      from: Number(b.from),
      to: Number(b.to),
      date: b.date,
      cents: Math.round(amount * 100),
      toCents: toAmount === undefined || !Number.isFinite(toAmount) ? undefined : Math.round(toAmount * 100),
      note: typeof b.note === "string" ? b.note : undefined,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return bad((e as Error).message);
  }
}
