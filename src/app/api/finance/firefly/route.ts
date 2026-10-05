import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { lastFireflySync, syncFirefly } from "@/lib/finance/firefly";
import { errorReason } from "@/lib/cache";
import { audit } from "@/lib/auth/users";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json({ configured: !!loadConfig().settings.finance.fireflyService, lastSync: lastFireflySync() });
}

export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  try {
    const result = await syncFirefly();
    audit(g.user.username, "finance-sync-firefly", result);
    return NextResponse.json({ ...result, lastSync: lastFireflySync() });
  } catch (e) {
    return NextResponse.json({ error: errorReason(e) }, { status: 502 });
  }
}
