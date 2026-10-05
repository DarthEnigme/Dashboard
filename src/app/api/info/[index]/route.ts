import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { cached, errorReason } from "@/lib/cache";
import { infoProviders } from "@/info";
import { seeFilter } from "@/lib/auth";
import type { Visibility } from "@/lib/config/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ index: string }> }) {
  const { index } = await params;
  const widget = loadConfig().widgets[Number(index)];
  const see = await seeFilter();
  if (!widget || !see((widget.visible as Visibility | undefined) ?? "public")) {
    return NextResponse.json({ error: "Unknown widget" }, { status: 404 });
  }

  const provider = infoProviders[widget.type];
  if (!provider) return NextResponse.json({ error: `Unknown widget type "${widget.type}"` }, { status: 400 });
  const parsed = provider.schema.safeParse(widget);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return NextResponse.json({ error: `Invalid ${widget.type} config: ${msg}` }, { status: 400 });
  }

  try {
    const key = `info|${widget.type}|${JSON.stringify(parsed.data)}`;
    return NextResponse.json(await cached(key, provider.ttlMs, () => provider.fetch(parsed.data)));
  } catch (e) {
    return NextResponse.json({ error: errorReason(e) }, { status: 502 });
  }
}
