import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { serviceIds } from "@/lib/config/slug";
import { serviceVisibility } from "@/lib/config/sanitize";
import { seeFilter } from "@/lib/auth";
import { checkSpec, describeCheck } from "@/lib/checks";
import { latestPing, openIncidents, pingsSince } from "@/lib/db";
import { certFor } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export interface StatusRow {
  id: string;
  name: string;
  group: string;
  icon?: string;
  href?: string;
  check: string;
  /** null: not checked yet. */
  up: boolean | null;
  latencyMs: number | null;
  at: number | null;
  /** Share of checks that were up in the last 24 hours (null without checks). */
  uptime: number | null;
  /** Down for at least alerts.threshold checks: an open incident. */
  incident: { since: number; cause: string | null } | null;
  certDaysLeft: number | null;
}

/** Every monitored service this viewer can see, for the monitoring panel. */
export async function GET() {
  const cfg = await getConfig();
  const see = await seeFilter();
  const ids = serviceIds(cfg.services);
  const open = new Map(openIncidents().map((i) => [i.service_id, i]));
  const since = Date.now() - 86_400_000;
  const rows: StatusRow[] = [];
  cfg.services.forEach((g, gi) => {
    g.services.forEach((s, si) => {
      const check = checkSpec(s);
      if (!check || !serviceVisibility(g, s).every(see)) return;
      const id = ids[gi][si];
      const last = latestPing(id);
      const day = pingsSince(id, since);
      const inc = open.get(id);
      rows.push({
        id,
        name: s.name,
        group: g.name,
        icon: s.icon,
        href: s.href,
        check: describeCheck(check),
        up: last ? !!last.up : null,
        latencyMs: last?.latency_ms ?? null,
        at: last?.ts ?? null,
        uptime: day.length ? day.filter((p) => p.up).length / day.length : null,
        incident: inc ? { since: inc.start, cause: inc.cause } : null,
        certDaysLeft: certFor(id)?.daysLeft ?? null,
      });
    });
  });
  return NextResponse.json(rows);
}
