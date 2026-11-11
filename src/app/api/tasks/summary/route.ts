import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { tasksSummary } from "@/lib/tasks/store";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** Your open and overdue counts, and the tasks due soon or late across your boards. */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(tasksSummary(g.user.id, loadConfig().settings.tasks.dueSoonDays));
}
