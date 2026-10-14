import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { createIncident, listIncidents } from "@/lib/statusIncidents";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Open incidents and those resolved in the last 30 days (?days= for more). Admins only. */
export async function GET(req: Request) {
  if (!(await requireAdmin())) return err("Admins only", 403);
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 30));
  return NextResponse.json(listIncidents(Date.now() - days * 86_400_000));
}

/** { title, impact?: minor|major|maintenance, services?: ids, status?, body } */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return err("Admins only", 403);
  if (!sameOrigin(req)) return err("Cross-site request refused", 403);
  try {
    const inc = createIncident(((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>, admin.username);
    audit(admin.username, "incident-post", { id: inc.id, title: inc.title, status: inc.status });
    return NextResponse.json(inc, { status: 201 });
  } catch (e) {
    return err((e as Error).message);
  }
}
