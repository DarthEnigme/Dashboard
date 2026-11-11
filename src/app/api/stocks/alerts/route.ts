import { NextResponse } from "next/server";
import { crudRoutes } from "@/lib/api";
import { configuredChannels } from "@/lib/alerts";
import { loadConfig } from "@/lib/config/load";
import { addAlert, deleteAlert, listAlerts, updateAlert } from "@/lib/stocks/alertStore";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** Your alert rules, and the alert channels they can go to. */
const reply = (userId: number) => ({ alerts: listAlerts(userId), channels: configuredChannels(loadConfig().settings.alerts) });

export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(reply(g.user.id));
}

/** POST { kind, op, value, symbol?, portfolio?, channels?, note?, active? }. PATCH { id, …the same }. DELETE ?id=. Each answers like GET. */
export const { POST, PATCH, DELETE } = crudRoutes(guard, { create: addAlert, update: updateAlert, remove: deleteAlert }, reply);
