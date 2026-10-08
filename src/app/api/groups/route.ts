import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { createGroup, deleteGroup, listGroups, PERMISSIONS, updateGroup, type Permission } from "@/lib/auth/groups";
import { audit } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

const clean = (b: Record<string, unknown>) => ({
  name: typeof b.name === "string" ? b.name.trim() : undefined,
  description: b.description === undefined ? undefined : typeof b.description === "string" && b.description.trim() ? b.description.trim().slice(0, 200) : null,
  permissions: Array.isArray(b.permissions) ? b.permissions.filter((p): p is Permission => (PERMISSIONS as readonly unknown[]).includes(p)) : undefined,
  sso: Array.isArray(b.sso) ? b.sso.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : undefined,
});

export async function GET() {
  if (!(await requireAdmin())) return err("Admins only", 403);
  return NextResponse.json(listGroups());
}

/** { name, description?, permissions?, sso? } */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin || !sameOrigin(req)) return err("Admins only", 403);
  const g = clean(((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>);
  if (!g.name) return err("Group name required");
  try {
    createGroup({ ...g, name: g.name });
  } catch (e) {
    const m = (e as Error).message;
    return err(/UNIQUE/.test(m) ? "A group with that name exists" : m);
  }
  audit(admin.username, "group-create", { name: g.name });
  return NextResponse.json(listGroups(), { status: 201 });
}

/** { id, name?, description?, permissions?, sso? } */
export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin || !sameOrigin(req)) return err("Admins only", 403);
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  try {
    updateGroup(Number(b.id), clean(b));
  } catch (e) {
    const m = (e as Error).message;
    return err(/UNIQUE/.test(m) ? "A group with that name exists" : m);
  }
  audit(admin.username, "group-update", { id: b.id, ...clean(b) });
  return NextResponse.json(listGroups());
}

/** ?id= — members lose what the group gave them; items shown to it stay hidden from them. */
export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin || !sameOrigin(req)) return err("Admins only", 403);
  const id = Number(new URL(req.url).searchParams.get("id"));
  deleteGroup(id);
  audit(admin.username, "group-delete", { id });
  return NextResponse.json(listGroups());
}
