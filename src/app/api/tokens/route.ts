import { NextResponse } from "next/server";
import { requireAdmin, sameOrigin } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { createToken, listTokens, revokeToken } from "@/lib/auth/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const forbidden = () => NextResponse.json({ error: "Admins only" }, { status: 403 });

export async function GET() {
  if (!(await requireAdmin())) return forbidden();
  return NextResponse.json(listTokens());
}

/** { name }: answers { token, list }; the token is shown this once. */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  const { name } = ((await req.json().catch(() => ({}))) ?? {}) as { name?: string };
  try {
    const r = createToken(admin.id, String(name ?? ""));
    audit(admin.username, "token-create", { name });
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  audit(admin.username, "token-revoke", { id });
  return NextResponse.json(revokeToken(id));
}
