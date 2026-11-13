import { NextResponse } from "next/server";
import { bad } from "@/lib/api";
import { audit } from "@/lib/auth/users";
import { safeText, toCsv } from "@/lib/finance/csvText";
import { oneOf } from "@/lib/clean";
import { writeXlsx } from "@/lib/xlsxWrite";
import { dividendsTable, figuresTable, positionsTable, transactionsTable, type Table } from "@/lib/stocks/exports";
import { factsFor, portfolioSnapshot } from "@/lib/stocks/service";
import { cleanSymbol, listTransactions } from "@/lib/stocks/store";
import { guard, portfoliosOf } from "../_shared";

export const dynamic = "force-dynamic";

const WHAT = ["transactions", "positions", "dividends", "figures"] as const;
const FORMATS = ["csv", "xlsx", "json"] as const;

/**
 * Download ?what=transactions (imports back as is) | positions | dividends | figures, as
 * ?format=csv | xlsx | json. ?portfolio= picks one portfolio (else all of them). Figures take
 * ?symbols=A,B (up to 20), ?measures=id,id (from the measures catalogue) and ?period=annual | quarterly.
 */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const q = new URL(req.url).searchParams;
  const what = oneOf(q.get("what"), WHAT, "transactions");
  const format = oneOf(q.get("format"), FORMATS, "csv");
  const portfolios = await portfoliosOf(g.user.id);
  const portfolio = portfolios.find((p) => p.id === Number(q.get("portfolio")));

  let table: Table;
  try {
    if (what === "transactions") table = transactionsTable(listTransactions(g.user.id, portfolio?.id), (id) => portfolios.find((p) => p.id === id)?.name ?? "");
    else if (what === "figures") {
      const symbols = [...new Set((q.get("symbols") ?? "").split(",").filter(Boolean).map(cleanSymbol))].slice(0, 20);
      const measures = (q.get("measures") ?? "").split(",").filter(Boolean).slice(0, 60);
      if (!symbols.length || !measures.length) return bad("Pick at least one symbol and one figure");
      table = figuresTable(await Promise.all(symbols.map(factsFor)), measures, q.get("period") === "quarterly" ? "quarterly" : "annual");
    } else {
      const data = await portfolioSnapshot(g.user.id, portfolios, portfolio?.id);
      table = what === "positions" ? positionsTable(data) : dividendsTable(data);
    }
  } catch (e) {
    return bad((e as Error).message);
  }
  audit(g.user.username, "stocks-export", { what, format, rows: table.length - 1 });

  const name = `nanodash-stocks-${what}${portfolio ? `-${portfolio.name.replace(/[^\w-]+/g, "_")}` : ""}.${format}`;
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" };
  if (format === "json") {
    const [head, ...rows] = table;
    return NextResponse.json(rows.map((r) => Object.fromEntries(head.map((h, i) => [String(h), r[i]]))), { headers });
  }
  if (format === "xlsx") return new NextResponse(new Uint8Array(writeXlsx(table, what)), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
  // Text can't run as a spreadsheet formula; numbers are written with a "." decimal.
  const csv = toCsv(table.map((r) => r.map((v) => (typeof v === "string" ? safeText(v) : v))));
  return new NextResponse(csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}
