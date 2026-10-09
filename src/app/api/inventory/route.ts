import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { addDevice, deleteDevice, listDevices, updateDevice } from "@/lib/inventory/store";

export const dynamic = "force-dynamic";

const guard = (req?: Request) => guardPermission("inventory", req, "the inventory");
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

/** Every device (the inventory is shared by everyone with the inventory permission). */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(listDevices());
}

export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  try {
    const b = await body(req);
    const list = addDevice(b);
    audit(g.user.username, "device-add", { name: b.name });
    return NextResponse.json(list, { status: 201 });
  } catch (e) {
    return bad((e as Error).message);
  }
}

/** { id, …fields to change } */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = await body(req);
  try {
    return NextResponse.json(updateDevice(Number(b.id), b));
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  audit(g.user.username, "device-delete", { id });
  return NextResponse.json(deleteDevice(id));
}
