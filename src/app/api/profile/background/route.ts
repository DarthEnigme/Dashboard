import { NextResponse } from "next/server";
import { requireUser, sameOrigin } from "@/lib/auth";
import * as users from "@/lib/auth/users";
import { formFile, removeUpload, saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Upload your own wallpaper (multipart `file`); it replaces the global one for you, and your previous one is deleted. */
export async function POST(req: Request) {
  const me = await requireUser();
  if (!me) return err("Sign in first", 401);
  if (!sameOrigin(req)) return err("Cross-site request refused", 403);
  try {
    const url = await saveUpload("backgrounds", await formFile(req, "backgrounds"));
    const prefs = users.getPrefs(me.id);
    users.setPrefs(me.id, { ...prefs, background: { ...prefs.background, image: url } });
    removeUpload(prefs.background?.image);
    return NextResponse.json({ url }, { status: 201 });
  } catch (e) {
    return err((e as Error).message);
  }
}

/** Remove your wallpaper: you see the global background again (or your own gradient). */
export async function DELETE(req: Request) {
  const me = await requireUser();
  if (!me) return err("Sign in first", 401);
  if (!sameOrigin(req)) return err("Cross-site request refused", 403);
  const prefs = users.getPrefs(me.id);
  const { background: { image, ...background } = {}, ...rest } = prefs;
  users.setPrefs(me.id, Object.keys(background).length ? { ...rest, background } : rest);
  removeUpload(image);
  return NextResponse.json({ ok: true });
}
