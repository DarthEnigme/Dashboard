import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { audit, type User } from "@/lib/auth/users";
import { addUpdate, deleteIncident, deleteUpdate, editIncident, getIncident } from "@/lib/statusIncidents";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });
type Ctx = { params: Promise<{ id: string }> };

async function admin(req: Request): Promise<{ error: NextResponse } | { admin: User }> {
  const a = await requireAdmin();
  if (!a) return { error: err("Admins only", 403) };
  if (!sameOrigin(req)) return { error: err("Cross-site request refused", 403) };
  return { admin: a };
}

/** { status, body } posts an update. */
export async function POST(req: Request, { params }: Ctx) {
  const g = await admin(req);
  if ("error" in g) return g.error;
  const id = Number((await params).id);
  try {
    const inc = addUpdate(id, ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>, g.admin.username);
    audit(g.admin.username, "incident-update", { id, status: inc.status });
    return NextResponse.json(inc);
  } catch (e) {
    return err((e as Error).message);
  }
}

/** { title?, impact?, services? } edits it. */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  const g = await admin(req);
  if ("error" in g) return g.error;
  try {
    const inc = editIncident(Number((await params).id), ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>);
    audit(g.admin.username, "incident-edit", { id: inc.id, title: inc.title });
    return NextResponse.json(inc);
  } catch (e) {
    return err((e as Error).message);
  }
}

/** Deletes the incident, or with ?update= one update of it. */
export async function DELETE(req: Request, { params }: Ctx): Promise<NextResponse> {
  const g = await admin(req);
  if ("error" in g) return g.error;
  const id = Number((await params).id);
  const inc = getIncident(id);
  if (!inc) return err("No such incident", 404);
  const update = new URL(req.url).searchParams.get("update");
  try {
    if (update) {
      const inc2 = deleteUpdate(id, Number(update));
      audit(g.admin.username, "incident-update-delete", { id, update: Number(update) });
      return NextResponse.json(inc2);
    }
  } catch (e) {
    return err((e as Error).message);
  }
  deleteIncident(id);
  audit(g.admin.username, "incident-delete", { id, title: inc.title });
  return NextResponse.json({ ok: true });
}
