import { NextResponse } from "next/server";
import { bad } from "@/lib/api";
import { prepareImport, rowsOf, saveTrades } from "@/lib/stocks/import";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * multipart: `file` (.csv or .xlsx from a broker), `portfolio`, `preset` (optional: found from the
 * columns). With ?preview=1, answers with what would be added (each trade with its Yahoo symbol, or
 * why it can't be added); without, adds the trades that can be and answers { added, skipped, unresolved }.
 */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) return bad("The file is too large (5 MB max)");
  const form = await req.formData().catch(() => undefined);
  const file = form?.get("file");
  if (!file || typeof file === "string") return bad("Choose a file to import");
  const portfolio = Number(form!.get("portfolio"));
  const preset = String(form!.get("preset") ?? "") || undefined;
  try {
    const rows = rowsOf(file.name, new Uint8Array(await file.arrayBuffer()));
    if (rows.length < 2) return bad("The file has no lines to import");
    const prepared = await prepareImport(g.user.id, portfolio, rows, preset);
    if (new URL(req.url).searchParams.get("preview")) return NextResponse.json(prepared);
    const label = prepared.presets.find((p) => p.id === prepared.preset)?.label ?? "Import";
    return NextResponse.json({ ...saveTrades(g.user.id, portfolio, prepared.trades, label), errors: prepared.errors }, { status: 201 });
  } catch (e) {
    return bad((e as Error).message);
  }
}
