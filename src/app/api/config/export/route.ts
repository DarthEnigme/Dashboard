import fs from "node:fs";
import { NextResponse } from "next/server";
import { filePath } from "@/lib/config/load";
import { configFiles, type ConfigFile } from "@/lib/config/schema";
import { canEdit } from "@/lib/auth";
import { zip } from "@/lib/zip";

export const dynamic = "force-dynamic";

/** The YAML files exactly as on disk (comments, env placeholders and secrets included), as a zip. */
export async function GET() {
  if (!(await canEdit())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const files = (Object.keys(configFiles) as ConfigFile[])
    .filter((f) => fs.existsSync(filePath(f)))
    .map((f) => ({ name: `${f}.yaml`, data: fs.readFileSync(filePath(f)) }));
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(zip(files)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="page-config-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
