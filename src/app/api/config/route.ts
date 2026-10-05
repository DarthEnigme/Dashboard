import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { readRaw } from "@/lib/config/load";
import { maskRaw, sanitize } from "@/lib/config/sanitize";
import { writeConfig } from "@/lib/config/write";
import { configFiles, type ConfigFile } from "@/lib/config/schema";
import { canEdit, sameOrigin, seeFilter, viewer } from "@/lib/auth";
import { saveVersionBefore } from "@/lib/config/history";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const config = sanitize(await getConfig(), await seeFilter());
  if (new URL(req.url).searchParams.get("raw") !== "1") return NextResponse.json(config);
  if (!(await canEdit())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const files = Object.keys(configFiles) as ConfigFile[];
  return NextResponse.json({
    ...Object.fromEntries(files.map((f) => [f, maskRaw(f, readRaw(f))])),
    // Docker-discovered services are shown read-only in the editor.
    discovered: config.services.flatMap((g) =>
      g.services.filter((s) => s.source === "docker").map((s) => ({ group: g.name, name: s.name, icon: s.icon })),
    ),
  });
}

export async function PUT(req: Request) {
  if (!(await canEdit()) || !sameOrigin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { file?: string; data?: unknown } | null;
  if (!body?.file || !(body.file in configFiles)) {
    return NextResponse.json({ error: "Unknown config file" }, { status: 400 });
  }
  const { user } = await viewer();
  saveVersionBefore(body.file as ConfigFile, user?.username ?? null);
  const result = writeConfig(body.file as ConfigFile, body.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}
