import { NextResponse } from "next/server";
import { canEdit, sameOrigin, viewer } from "@/lib/auth";
import { readRaw } from "@/lib/config/load";
import { saveVersionBefore } from "@/lib/config/history";
import { writeConfig } from "@/lib/config/write";
import { convertHomepage, type HomepageFiles } from "@/lib/import/homepage";
import { audit } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

type Obj = Record<string, unknown>;

/**
 * Import a gethomepage.dev config.
 * { files } → preview (counts, warnings). { files, mode: "replace" | "merge", commit: true } → write.
 * Settings are always merged (auth, alerts and other Page-only settings stay); "merge" also keeps
 * existing groups and only adds groups whose names are new.
 */
export async function POST(req: Request) {
  if (!(await canEdit()) || !sameOrigin(req)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { files?: HomepageFiles; mode?: "replace" | "merge"; commit?: boolean };
  if (!b.files || !Object.values(b.files).some((t) => t?.trim())) return NextResponse.json({ error: "Add at least one Homepage YAML file" }, { status: 400 });

  const c = convertHomepage(b.files);
  const summary = {
    services: c.services.reduce((a, g) => a + (g.services as unknown[]).length, 0),
    groups: c.services.length,
    bookmarks: c.bookmarks.length,
    widgets: c.widgets.length,
    warnings: c.warnings,
  };
  if (!b.commit) return NextResponse.json(summary);

  const merge = b.mode === "merge";
  const list = (file: "services" | "bookmarks" | "widgets") => (Array.isArray(readRaw(file)) ? (readRaw(file) as Obj[]) : []);
  const combine = (existing: Obj[], incoming: Obj[]) =>
    merge ? [...existing, ...incoming.filter((g) => !existing.some((e) => e.name === g.name))] : incoming;

  const writes: [Parameters<typeof writeConfig>[0], unknown][] = [];
  if (b.files.settings?.trim()) writes.push(["settings", { ...((readRaw("settings") as Obj | undefined) ?? {}), ...c.settings }]);
  if (b.files.services?.trim()) writes.push(["services", combine(list("services"), c.services)]);
  if (b.files.bookmarks?.trim()) writes.push(["bookmarks", combine(list("bookmarks"), c.bookmarks)]);
  if (b.files.widgets?.trim()) writes.push(["widgets", merge ? [...list("widgets"), ...c.widgets] : c.widgets]);

  const { user } = await viewer();
  for (const [file, data] of writes) {
    saveVersionBefore(file, user?.username ?? null);
    const r = writeConfig(file, data);
    if (!r.ok) return NextResponse.json({ error: `${file}.yaml: ${r.error}` }, { status: 422 });
  }
  audit(user?.username ?? null, "config-import-homepage", { mode: b.mode, files: writes.map(([f]) => f) });
  return NextResponse.json({ ...summary, written: writes.map(([f]) => f) });
}
