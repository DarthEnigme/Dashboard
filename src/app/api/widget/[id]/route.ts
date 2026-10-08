import { NextResponse } from "next/server";
import { findService } from "@/lib/config/lookup";
import { seeFilter, viewer } from "@/lib/auth";
import { errorReason } from "@/lib/cache";
import { fetchWidget, WidgetError } from "@/lib/widgets";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await findService(id, await seeFilter());
  if (!service?.widget) return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  // The finance tile shows the tracker's numbers: same permission as the finance page.
  if (service.widget.type === "finance" && !(await viewer()).permissions.includes("finance")) {
    return NextResponse.json({ error: "No access to finance" }, { status: 403 });
  }
  try {
    return NextResponse.json(await fetchWidget(id, service));
  } catch (e) {
    if (e instanceof WidgetError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: errorReason(e) }, { status: 502 });
  }
}
