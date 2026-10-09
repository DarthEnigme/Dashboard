import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { addTransaction, listTransactions } from "@/lib/finance/store";
import { bad, guard, isDate } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = new URL(req.url).searchParams;
  const period = q.get("period");
  const range = period && /^\d{4}(-\d{2})?$/.test(period) ? { from: period.length === 4 ? `${period}-01-01` : `${period}-01`, to: `${period.length === 4 ? `${period}-12` : period}-31` } : {};
  return NextResponse.json(
    listTransactions({ ...range, category: q.get("category") ?? undefined, account: q.get("account") ?? undefined, q: q.get("q") ?? undefined, limit: 2000 }),
  );
}

export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const amount = Number(b.amount);
  if (!isDate(b.date)) return bad("Date must be YYYY-MM-DD");
  if (!Number.isFinite(amount) || amount === 0) return bad("Amount must be a non-zero number");
  if (typeof b.description !== "string" || !b.description.trim()) return bad("Description required");
  addTransaction({
    date: b.date,
    amountCents: Math.round(amount * 100),
    currency: typeof b.currency === "string" && b.currency.length === 3 ? b.currency : loadConfig().settings.finance.currency,
    description: b.description.trim().slice(0, 300),
    category: typeof b.category === "string" ? b.category.slice(0, 60) : null,
    account: typeof b.account === "string" ? b.account.slice(0, 60) : null,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}
