import { NextResponse } from "next/server";
import { seeFilter, viewer } from "@/lib/auth";
import { findService } from "@/lib/config/lookup";
import { notesForService } from "@/lib/notes/store";

export const dynamic = "force-dynamic";

/**
 * The runbooks of a service, for its page: readable by whoever can see the service (without the
 * notes permission); `canEdit` says whether this viewer may edit them in Notes.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  if (!(await findService(id, await seeFilter()))) return NextResponse.json({ error: "No such service" }, { status: 404 });
  const v = await viewer();
  return NextResponse.json({ notes: notesForService(id), canEdit: v.permissions.includes("notes") });
}
