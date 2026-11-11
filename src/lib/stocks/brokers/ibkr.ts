import { XMLParser } from "fast-xml-parser";
import { http, trimSlash } from "../../http";
import { readTrades } from "../import/presets";
import type { Broker } from "./types";

/**
 * Interactive Brokers' Flex Web Service: a Flex query of trades (set up once in the Client Portal)
 * is asked for with its token, then fetched when IBKR has made it. Its Trade elements carry the
 * same names as a Flex CSV, so they go through the same reading as an imported file.
 */

const base = () => trimSlash(process.env.PAGE_IBKR_URL ?? "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService");
const wait = () => Number(process.env.PAGE_IBKR_WAIT_MS ?? 5000);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", isArray: (name) => name === "Trade" || name === "FlexStatement" });

type Xml = Record<string, unknown>;
const get = async (url: string) => parser.parse(await (await http(url, { timeoutMs: 30_000 })).text()) as Xml;
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v ? [v as T] : []);

/** The Trade elements of a statement as rows: a header of their attribute names, then one row each. */
export function tradeRows(statement: Xml): string[][] {
  const statements = list<Xml>((statement.FlexQueryResponse as Xml | undefined)?.FlexStatements && ((statement.FlexQueryResponse as Xml).FlexStatements as Xml).FlexStatement);
  const trades = statements.flatMap((s) => list<Record<string, string>>((s.Trades as Xml | undefined)?.Trade));
  if (!trades.length) return [];
  const names = [...new Set(trades.flatMap((t) => Object.keys(t)))];
  return [names, ...trades.map((t) => names.map((n) => String(t[n] ?? "")))];
}

/** IBKR's reason when it refuses or isn't ready (1019: the statement is still being made). */
const refusal = (r: Xml) => {
  const res = r.FlexStatementResponse as Xml | undefined;
  return res && String(res.Status) !== "Success" ? { code: String(res.ErrorCode ?? ""), message: String(res.ErrorMessage ?? "Flex request refused") } : undefined;
};

export const ibkr: Broker = {
  kind: "ibkr",
  async trades(token, queryId) {
    if (!queryId) throw new Error("The Flex query id is missing");
    const t = encodeURIComponent(token);
    const asked = await get(`${base()}/SendRequest?t=${t}&q=${encodeURIComponent(queryId)}&v=3`);
    const refused = refusal(asked);
    if (refused) throw new Error(`IBKR: ${refused.message}`);
    const res = asked.FlexStatementResponse as Xml;
    const reference = String(res.ReferenceCode ?? "");
    const url = trimSlash(String(res.Url ?? `${base()}/GetStatement`));
    for (let attempt = 0; attempt < 8; attempt++) {
      const statement = await get(`${url}?t=${t}&q=${encodeURIComponent(reference)}&v=3`);
      const notYet = refusal(statement);
      if (notYet?.code === "1019") {
        await new Promise((r) => setTimeout(r, wait()));
        continue;
      }
      if (notYet) throw new Error(`IBKR: ${notYet.message}`);
      const rows = tradeRows(statement);
      return rows.length ? readTrades(rows, "ibkr").trades : [];
    }
    throw new Error("IBKR took too long to make the statement; try again in a minute");
  },
};
