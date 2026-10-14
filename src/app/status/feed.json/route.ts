import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { statusPageData } from "@/lib/statusPage";

export const dynamic = "force-dynamic";

/** The public status page as JSON, for other tools: the same data, nothing more. 404 while the page is off. */
export async function GET() {
  const cfg = loadConfig().settings.statusPage;
  if (!cfg.enabled) return NextResponse.json({ error: "No status page" }, { status: 404 });
  return NextResponse.json(await statusPageData(cfg), { headers: { "Cache-Control": "no-store" } });
}
