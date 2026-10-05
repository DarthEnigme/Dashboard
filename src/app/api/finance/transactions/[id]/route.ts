import { NextResponse } from "next/server";
import { deleteTransaction, updateTransaction } from "@/lib/finance/store";
import { bad, guard, isDate } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (b.date !== undefined && !isDate(b.date)) return bad("Date must be YYYY-MM-DD");
  const amount = b.amount === undefined ? undefined : Number(b.amount);
  if (amount !== undefined && (!Number.isFinite(amount) || amount === 0)) return bad("Amount must be a non-zero number");
  updateTransaction(Number((await params).id), {
    date: b.date as string | undefined,
    amountCents: amount === undefined ? undefined : Math.round(amount * 100),
    description: typeof b.description === "string" ? b.description.trim().slice(0, 300) : undefined,
    category: b.category === undefined ? undefined : typeof b.category === "string" ? b.category : null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  deleteTransaction(Number((await params).id));
  return NextResponse.json({ ok: true });
}
