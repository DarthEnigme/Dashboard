import { NextResponse } from "next/server";
import { findService } from "@/lib/config/lookup";
import { requirePermission, sameOrigin, seeFilter } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { errorReason, forget } from "@/lib/cache";
import { integrations } from "@/integrations";
import type { ServiceAction } from "@/integrations/types";
import { wake } from "@/lib/wol";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const WAKE: ServiceAction = { id: "wake", label: "Wake (Wake-on-LAN)" };

/**
 * Resolve the service's actions for people with the actions permission who can see the service:
 * its integration's (start, stop…) and, with `wol:`, Wake-on-LAN.
 */
async function resolve(id: string) {
  const admin = await requirePermission("actions");
  if (!admin) return { error: NextResponse.json({ error: "You can't run actions. Ask an admin." }, { status: 403 }) };
  const service = await findService(id, await seeFilter());
  const integration = service?.widget ? integrations[service.widget.type] : undefined;
  const wol = service?.wol;
  if (!service || (!integration?.actions && !wol)) return { error: NextResponse.json({ error: "No actions for this service" }, { status: 404 }) };
  let cfg: unknown;
  if (integration?.actions) {
    const parsed = integration.schema.safeParse(service.widget);
    if (!parsed.success) return { error: NextResponse.json({ error: "Invalid widget config" }, { status: 400 }) };
    cfg = parsed.data;
  }
  const list = async () => [...(integration?.actions && cfg !== undefined ? await integration.actions.list(cfg) : []), ...(wol ? [WAKE] : [])];
  const run = (action: string, target?: string) =>
    action === WAKE.id && wol && !target ? wake(wol.mac, wol.broadcast) : integration!.actions!.run(cfg, action, target);
  return { admin, list, run };
}

export async function GET(_req: Request, { params }: Ctx) {
  const r = await resolve((await params).id);
  if ("error" in r) return r.error;
  try {
    return NextResponse.json(await r.list());
  } catch (e) {
    return NextResponse.json({ error: errorReason(e) }, { status: 502 });
  }
}

export async function POST(req: Request, { params }: Ctx) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  const id = (await params).id;
  const r = await resolve(id);
  if ("error" in r) return r.error;
  const { action, target } = ((await req.json().catch(() => ({}))) ?? {}) as { action?: string; target?: string };
  try {
    // Only actions the service currently offers can run (no arbitrary verbs or targets).
    const allowed = (await r.list()).some((a) => a.id === action && (a.target ?? undefined) === (target ?? undefined));
    if (!action || !allowed) return NextResponse.json({ error: "That action isn't available right now" }, { status: 409 });
    const message = await r.run(action, target);
    audit(r.admin.username, "service-action", { service: id, action, target });
    // The tile shows the new state on its next fetch, not the cached one.
    forget(`widget|${id}|`);
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    audit(r.admin.username, "service-action-failed", { service: id, action, target, error: errorReason(e) });
    return NextResponse.json({ error: errorReason(e) }, { status: 502 });
  }
}
