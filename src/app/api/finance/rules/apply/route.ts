import { NextResponse } from "next/server";
import { audit } from "@/lib/auth/users";
import { applyRules } from "@/lib/finance/store";
import { guard } from "../../_shared";

export const dynamic = "force-dynamic";

/** Give uncategorised transactions the category of the first rule that matches them. */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const changed = applyRules();
  audit(g.user.username, "finance-rules-apply", { changed });
  return NextResponse.json({ changed });
}
