import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listVersions } from "@/lib/config/history";
import { configFiles, type ConfigFile } from "@/lib/config/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const file = new URL(req.url).searchParams.get("file");
  if (file && !(file in configFiles)) return NextResponse.json({ error: "Unknown config file" }, { status: 400 });
  return NextResponse.json(listVersions((file as ConfigFile) ?? undefined));
}
