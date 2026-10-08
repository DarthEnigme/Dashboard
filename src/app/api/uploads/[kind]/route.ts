import { NextResponse } from "next/server";
import { canEdit, requireUser, sameOrigin } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { formFile, saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string }> };

/** Upload a wallpaper or a logo (admins). Profile pictures go through /api/profile/avatar. */
export async function POST(req: Request, { params }: Ctx) {
  const { kind } = await params;
  if (kind !== "backgrounds" && kind !== "logos") return NextResponse.json({ error: "Unknown upload kind" }, { status: 404 });
  if (!(await canEdit()) || !sameOrigin(req)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const url = await saveUpload(kind, await formFile(req, kind));
    audit((await requireUser())?.username ?? null, `upload-${kind.slice(0, -1)}`, { url });
    return NextResponse.json({ url }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
