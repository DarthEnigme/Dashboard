import { NextResponse } from "next/server";
import { seeFilter } from "@/lib/auth";
import { findService } from "@/lib/config/lookup";
import { tasksForService } from "@/lib/tasks/store";
import { guard } from "../../_shared";

export const dynamic = "force-dynamic";

/** Your open tasks about a service, for its page (only to someone with the task boards who can see the service). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if ("error" in g) return g.error;
  const id = decodeURIComponent((await params).id);
  if (!(await findService(id, await seeFilter()))) return NextResponse.json({ error: "No such service" }, { status: 404 });
  return NextResponse.json(tasksForService(g.user.id, id));
}
