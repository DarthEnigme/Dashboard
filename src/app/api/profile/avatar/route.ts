import { NextResponse } from "next/server";
import { requireUser, sameOrigin } from "@/lib/auth";
import * as users from "@/lib/auth/users";
import { formFile, removeUpload, saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Upload your profile picture (multipart `file`); the previous one is deleted. */
export async function POST(req: Request) {
  const me = await requireUser();
  if (!me) return err("Sign in first", 401);
  if (!sameOrigin(req)) return err("Cross-site request refused", 403);
  try {
    const url = await saveUpload("avatars", await formFile(req, "avatars"));
    users.updateUser(me.id, { avatar: url });
    removeUpload(me.avatar);
    return NextResponse.json({ url }, { status: 201 });
  } catch (e) {
    return err((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  const me = await requireUser();
  if (!me) return err("Sign in first", 401);
  if (!sameOrigin(req)) return err("Cross-site request refused", 403);
  users.updateUser(me.id, { avatar: null });
  removeUpload(me.avatar);
  return NextResponse.json({ ok: true });
}
