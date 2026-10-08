import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { createShortcut, deleteShortcut, listShortcuts } from "@/lib/finance/recurring";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(listShortcuts());
}

/** { label, amount (negative = expense), currency?, category? }: a one-tap transaction. */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const amount = Number(b.amount);
  if (typeof b.label !== "string" || !b.label.trim()) return bad("Label required");
  if (!Number.isFinite(amount) || amount === 0) return bad("Amount must be a non-zero number");
  createShortcut({
    label: b.label.trim().slice(0, 60),
    amount_cents: Math.round(amount * 100),
    currency: typeof b.currency === "string" && /^[A-Za-z]{3}$/.test(b.currency) ? b.currency : loadConfig().settings.finance.currency,
    category: typeof b.category === "string" && b.category.trim() ? b.category.trim().slice(0, 60) : null,
  });
  return NextResponse.json(listShortcuts(), { status: 201 });
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  deleteShortcut(Number(new URL(req.url).searchParams.get("id")));
  return NextResponse.json(listShortcuts());
}
