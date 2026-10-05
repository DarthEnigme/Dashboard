import { NextResponse } from "next/server";
import { findService } from "@/lib/config/lookup";
import { seeFilter } from "@/lib/auth";
import { cached, errorReason } from "@/lib/cache";
import { integrations } from "@/integrations";

export const dynamic = "force-dynamic";

const RANGES = ["1h", "24h", "7d"] as const;

/** Charts for one row of a widget (e.g. a Proxmox guest): ?target=pve1/qemu/102&range=1h|24h|7d. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await findService(id, await seeFilter());
  const integration = service?.widget ? integrations[service.widget.type] : undefined;
  if (!service || !integration?.series) return NextResponse.json({ error: "No charts for this service" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  const target = q.get("target") ?? "";
  const range = (RANGES as readonly string[]).includes(q.get("range") ?? "") ? (q.get("range") as (typeof RANGES)[number]) : "1h";
  const parsed = integration.schema.safeParse(service.widget);
  if (!parsed.success) return NextResponse.json({ error: "Invalid widget config" }, { status: 400 });
  try {
    return NextResponse.json(await cached(`series|${id}|${target}|${range}`, 30_000, () => integration.series!(parsed.data, target, range)));
  } catch (e) {
    return NextResponse.json({ error: errorReason(e) }, { status: 502 });
  }
}
