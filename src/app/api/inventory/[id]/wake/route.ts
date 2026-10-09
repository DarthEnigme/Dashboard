import { NextResponse } from "next/server";
import { guardPermission, requirePermission } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { getDevice } from "@/lib/inventory/store";
import { wake } from "@/lib/wol";

export const dynamic = "force-dynamic";

/** Send Wake-on-LAN to a device: needs the inventory and the actions permission; audited. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardPermission("inventory", req, "the inventory");
  if ("error" in g) return g.error;
  if (!(await requirePermission("actions"))) return NextResponse.json({ error: "You can't run actions. Ask an admin." }, { status: 403 });
  const d = getDevice(Number((await params).id));
  if (!d) return NextResponse.json({ error: "No such device" }, { status: 404 });
  if (!d.mac) return NextResponse.json({ error: `${d.name} has no MAC address` }, { status: 400 });
  try {
    const message = await wake(d.mac, d.wol_broadcast);
    audit(g.user.username, "device-wake", { device: d.name, mac: d.mac });
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
