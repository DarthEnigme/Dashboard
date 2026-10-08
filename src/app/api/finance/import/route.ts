import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { guessMapping, mapRows, parseCsv, type CsvMapping } from "@/lib/finance/csv";
import { importTransactions } from "@/lib/finance/store";
import { audit } from "@/lib/auth/users";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

const MAX = 5 * 1024 * 1024;

/**
 * { text } → the first rows and a guessed mapping.
 * { text, mapping } → a preview of parsed transactions (and errors).
 * { text, mapping, commit: true } → import; duplicates (same file again) are skipped.
 */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { text?: string; mapping?: CsvMapping; commit?: boolean; currency?: string };
  if (!b.text) return bad("Paste or upload a CSV file");
  if (b.text.length > MAX) return bad("File too large (5 MB max)");
  const rows = parseCsv(b.text);
  if (!rows.length) return bad("The file has no rows");
  if (!b.mapping) return NextResponse.json({ rows: rows.slice(0, 8), columns: rows[0].length, guess: guessMapping(rows[0]) });

  const m = b.mapping;
  if (m.date === undefined || m.description === undefined || (m.amount === undefined && m.debit === undefined && m.credit === undefined)) {
    return bad("Choose the date, description and amount (or debit/credit) columns");
  }
  const { transactions, errors } = mapRows(rows, m);
  if (!b.commit) return NextResponse.json({ preview: transactions.slice(0, 10), total: transactions.length, errors: errors.slice(0, 20) });

  const currency = typeof b.currency === "string" && /^[A-Za-z]{3}$/.test(b.currency) ? b.currency.toUpperCase() : loadConfig().settings.finance.currency;
  const result = importTransactions(
    transactions.map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      currency,
      description: t.description,
      category: t.category,
      source: "csv" as const,
      externalId: t.externalId,
    })),
  );
  audit(g.user.username, "finance-import-csv", result);
  return NextResponse.json({ ...result, errors: errors.length });
}
