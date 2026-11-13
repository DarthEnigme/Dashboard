import { NextResponse } from "next/server";
import { bad } from "@/lib/api";
import { errorReason } from "@/lib/cache";
import { loadInvestor } from "@/lib/stocks/investors";
import { NoContact } from "@/lib/stocks/investors/sec";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * ?cik=: what that investor held at the end of the last quarter they reported (13F), against the
 * quarter before, crossed with what you hold. 409 with `noContact` until an admin sets the e-mail the SEC asks for.
 */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const cik = Number(new URL(req.url).searchParams.get("cik"));
  if (!Number.isInteger(cik) || cik <= 0 || cik > 9_999_999_999) return bad("Pick an investor");
  try {
    return NextResponse.json(await loadInvestor(g.user.id, cik));
  } catch (e) {
    if (e instanceof NoContact) return NextResponse.json({ error: e.message, noContact: true }, { status: 409 });
    return bad(`SEC: ${errorReason(e)}`, 502);
  }
}
