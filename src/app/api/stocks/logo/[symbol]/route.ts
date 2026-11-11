import { NextResponse } from "next/server";
import { bad } from "@/lib/api";
import { logoFor, setOwnLogo } from "@/lib/stocks/logos";
import { SYMBOL } from "@/lib/stocks/types";
import { guard } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ symbol: string }> };
const symbolOf = async (ctx: Ctx) => {
  const symbol = decodeURIComponent((await ctx.params).symbol).toUpperCase();
  return SYMBOL.test(symbol) ? symbol : undefined;
};

/** The symbol's logo (yours, else the company's), or 404: the page then draws a monogram. */
export async function GET(_req: Request, ctx: Ctx) {
  const g = await guard();
  if ("error" in g) return g.error;
  const symbol = await symbolOf(ctx);
  const logo = symbol && (await logoFor(symbol, g.user.id));
  if (!logo) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
  return new NextResponse(Buffer.from(logo.data), { headers: { "Content-Type": logo.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}

/** multipart `file`: a logo of your own for this symbol. */
export async function POST(req: Request, ctx: Ctx) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const symbol = await symbolOf(ctx);
  if (!symbol) return bad("No such symbol", 404);
  try {
    const file = (await req.formData()).get("file");
    if (!file || typeof file === "string") return bad("Choose an image file");
    setOwnLogo(symbol, g.user.id, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return bad((e as Error).message);
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** Back to the company's logo. */
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const symbol = await symbolOf(ctx);
  if (symbol) setOwnLogo(symbol, g.user.id, null);
  return NextResponse.json({ ok: true });
}
