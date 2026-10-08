import { NextResponse } from "next/server";
import { deleteCategory, ensureCategory, listCategories, renameCategory, setCategoryBudget, setCategoryColor, setCategorySlot } from "@/lib/finance/store";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(listCategories());
}

/**
 * { name } creates; { name, rename } renames or merges; { name, slot } sets the chart colour (1–8 or null);
 * { name, budget } sets the monthly budget in cents (null removes it); { name, color } sets an own colour (#rrggbb, null removes it).
 */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { name?: string; rename?: string; slot?: number | null; budget?: number | null; color?: string | null };
  if (!b.name?.trim()) return bad("Category name required");
  try {
    if (b.rename !== undefined) renameCategory(b.name, b.rename);
    else if (b.slot === undefined && b.budget === undefined && b.color === undefined) ensureCategory(b.name);
    else {
      if (b.slot !== undefined) setCategorySlot(b.name, b.slot);
      if (b.budget !== undefined) setCategoryBudget(b.name, b.budget);
      if (b.color !== undefined) setCategoryColor(b.name, b.color);
    }
  } catch (e) {
    return bad((e as Error).message);
  }
  return NextResponse.json(listCategories());
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return bad("name required");
  deleteCategory(name);
  return NextResponse.json(listCategories());
}
