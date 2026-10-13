import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { serviceIds } from "@/lib/config/slug";
import { serviceVisibility } from "@/lib/config/sanitize";
import { seeFilter, viewer } from "@/lib/auth";
import { checkSpec, describeCheck } from "@/lib/checks";
import { latestPing, openIncidents, uptimeSince } from "@/lib/db";
import { certFor } from "@/lib/monitor";
import { listMutes, mutedNow } from "@/lib/maintenance";

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
  /** Alerts are held back right now (maintenance window or a one-off mute). */
  muted: boolean;
  /** Admins only: why (the note on the mute or window). */
  mutedNote?: string;
}

/** Every monitored service this viewer can see, for the monitoring panel. */
export async function GET() {
  const cfg = await getConfig();
  const see = await seeFilter();
  const ids = serviceIds(cfg.services);
  const open = new Map(openIncidents().map((i) => [i.service_id, i]));
  const day = uptimeSince(Date.now() - 86_400_000);
  const rows: StatusRow[] = [];
  const mutes = listMutes();
  const now = new Date();
  const admin = (await viewer()).role === "admin";
  cfg.services.forEach((g, gi) => {
    g.services.forEach((s, si) => {
      const check = checkSpec(s);
      if (!check || !serviceVisibility(g, s).every(see)) return;
      const id = ids[gi][si];
      const last = latestPing(id);
      const checks = day.get(id);
      const inc = open.get(id);
      const muted = mutedNow(cfg.settings.maintenance, mutes, id, now);
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
        uptime: checks?.checks ? checks.up / checks.checks : null,
        incident: inc ? { since: inc.start, cause: inc.cause } : null,
        certDaysLeft: certFor(id)?.daysLeft ?? null,
        muted: !!muted,
        mutedNote: admin ? muted?.note : undefined,
      });
    });
  });
  return NextResponse.json(rows);
}
