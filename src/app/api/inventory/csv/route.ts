import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { devicesCsv, importDevices } from "@/lib/inventory/store";

export const dynamic = "force-dynamic";

const guard = (req?: Request) => guardPermission("inventory", req, "the inventory");

/** Every device as CSV (imports back as is). */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(devicesCsv(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="page-inventory-${stamp}.csv"`, "Cache-Control": "no-store" },
  });
}

/** { text }: a CSV whose first row names the columns. Matching MACs (or names) are updated. */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const { text } = ((await req.json().catch(() => ({}))) ?? {}) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "Paste or upload a CSV file" }, { status: 400 });
  if (text.length > 2_000_000) return NextResponse.json({ error: "File too large (2 MB max)" }, { status: 400 });
  try {
    const r = importDevices(text);
    audit(g.user.username, "device-import", { added: r.added, updated: r.updated, errors: r.errors.length });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
