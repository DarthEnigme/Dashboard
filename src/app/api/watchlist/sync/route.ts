import { NextResponse } from "next/server";
import { guardPermission, seeFilter } from "@/lib/auth";
import { findService } from "@/lib/config/lookup";
import { getSync, mediaServices, setSync, syncUser } from "@/lib/watchlist/sync";
import { listItems, tagsAndLists, watchStats } from "@/lib/watchlist/store";

export const dynamic = "force-dynamic";

const guard = (req?: Request) => guardPermission("watchlist", req, "the watchlist");
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Jellyfin and Plex servers this viewer can see (ids and names only). */
async function choices() {
  const see = await seeFilter();
  const all = await mediaServices();
  const visible = await Promise.all(all.map(async (s) => ((await findService(s.id, see)) ? s : null)));
  return visible.filter((s) => s !== null);
}

/** Your link to a Jellyfin/Plex account, and the servers you can link to. */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json({ setup: getSync(g.user.id) ?? null, services: await choices() });
}

/** { serviceId, mediaUser } links your account there; { serviceId: null } unlinks. */
export async function PUT(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { serviceId?: string | null; mediaUser?: string };
  if (b.serviceId && !(await choices()).some((s) => s.id === b.serviceId)) return bad("Not a Jellyfin or Plex server you can use", 404);
  setSync(g.user.id, b.serviceId ?? null, b.mediaUser ?? null);
  return NextResponse.json({ setup: getSync(g.user.id) ?? null, services: await choices() });
}

/** Sync now; answers with the updated watchlist. */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  try {
    const result = await syncUser(g.user.id);
    const items = listItems(g.user.id);
    return NextResponse.json({ ...result, setup: getSync(g.user.id), items, stats: watchStats(items), ...tagsAndLists(items) });
  } catch (e) {
    return bad((e as Error).message, 502);
  }
}
