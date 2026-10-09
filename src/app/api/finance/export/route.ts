import { centsToDecimal, safeText, toCsv } from "@/lib/finance/csv";
import { listTransactions } from "@/lib/finance/store";
import { audit } from "@/lib/auth/users";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

const HEADER = ["date", "description", "amount", "currency", "category", "account", "source"];

/**
 * Download transactions as CSV (default) or JSON (?format=json). Same filters as the list:
 * ?period=2026-10 or 2026 (omit for everything), ?category= ("" = uncategorised), ?account=, ?q=.
 * The CSV imports back as is: the column names match the importer's guesses, decimals use ".".
 */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = new URL(req.url).searchParams;
  const period = q.get("period");
  if (period && !/^\d{4}(-\d{2})?$/.test(period)) return bad("period must be YYYY or YYYY-MM");
  const format = q.get("format") === "json" ? "json" : "csv";
  const range = period ? { from: period.length === 4 ? `${period}-01-01` : `${period}-01`, to: `${period.length === 4 ? `${period}-12` : period}-31` } : {};
  const txns = listTransactions({ ...range, category: q.get("category") ?? undefined, account: q.get("account") ?? undefined, q: q.get("q") ?? undefined, limit: -1 }) // -1: no limit
    // Oldest first reads better in a spreadsheet.
    .reverse();
  audit(g.user.username, "finance-export", { format, period, count: txns.length });

  const name = `page-finance-${period ?? "all"}.${format}`;
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" };
  if (format === "json") {
    const body = txns.map((t) => ({
      date: t.date,
      description: t.description,
      amount: t.amount_cents / 100,
      currency: t.currency,
      category: t.category,
      account: t.account,
      source: t.source,
    }));
    return new Response(JSON.stringify(body, null, 2), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  }
  const rows = txns.map((t) => [t.date, safeText(t.description), centsToDecimal(t.amount_cents), t.currency, safeText(t.category), safeText(t.account), t.source]);
  // A BOM so Excel opens accents correctly; the importer strips it.
  return new Response(`﻿${toCsv([HEADER, ...rows])}`, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}
