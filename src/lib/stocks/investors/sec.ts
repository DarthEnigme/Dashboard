import { XMLParser } from "fast-xml-parser";
import { http, httpJson, trimSlash } from "../../http";

/**
 * The SEC's EDGAR, without a key: a filer's list of filings, and the holdings table of a 13F report.
 * The SEC asks automated tools to say who they are with a contact e-mail in the User-Agent, and
 * refuses the archives otherwise: the admin sets it (settings, or PAGE_SEC_CONTACT). PAGE_SEC_URL and
 * PAGE_SEC_DATA_URL point tests at a mock.
 */

const archives = () => trimSlash(process.env.PAGE_SEC_URL ?? "https://www.sec.gov");
const data = () => trimSlash(process.env.PAGE_SEC_DATA_URL ?? "https://data.sec.gov");

export class NoContact extends Error {
  constructor() {
    super("The SEC asks for a contact e-mail: an admin sets it in Settings → Monitoring & alerts.");
  }
}

const headers = (contact: string | undefined) => {
  if (!contact) throw new NoContact();
  return { "User-Agent": `NanoDash self-hosted dashboard ${contact}` };
};

export interface Filing {
  accession: string;
  /** When it was filed. */
  filed: string;
  /** The quarter it reports (its last day). */
  period: string;
}

export interface FilerFilings {
  name: string;
  /** 13F reports, latest first (amendments left out: they may hold only part of the quarter). */
  filings: Filing[];
}

interface Submissions {
  name?: string;
  filings?: { recent?: { accessionNumber?: string[]; form?: string[]; filingDate?: string[]; reportDate?: string[] } };
}

export function parseSubmissions(s: Submissions): FilerFilings {
  const r = s.filings?.recent;
  const forms = r?.form ?? [];
  const filings = forms.flatMap((form, i) =>
    form === "13F-HR" && r?.accessionNumber?.[i] && r.filingDate?.[i] ? [{ accession: r.accessionNumber[i], filed: r.filingDate[i], period: r.reportDate?.[i] || r.filingDate[i] }] : [],
  );
  return { name: s.name ?? "", filings: filings.sort((a, b) => b.filed.localeCompare(a.filed)) };
}

export interface Holding13F {
  cusip: string;
  /** As filed, in capitals ("APPLE INC"). */
  issuer: string;
  /** COM, CL A, SPONSORED ADR… */
  title: string;
  /** In US dollars. */
  value: number;
  shares: number;
  /** Options are listed apart from the shares. */
  putCall: "Put" | "Call" | null;
}

const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, isArray: (name) => name === "infoTable" });
const n = (v: unknown) => Number(String(v ?? "").replace(/,/g, "")) || 0;

/**
 * The holdings table of a 13F, one row per security (a filer may list the same one several times,
 * once per manager). Until 2023 values were filed in thousands of dollars, since then in dollars.
 */
export function parseInfoTable(xml: string, filed: string): Holding13F[] {
  const doc = parser.parse(xml) as { informationTable?: { infoTable?: Record<string, unknown>[] } };
  const thousands = filed < "2023-01-03";
  const rows = new Map<string, Holding13F>();
  for (const r of doc.informationTable?.infoTable ?? []) {
    const cusip = String(r.cusip ?? "").toUpperCase();
    const putCall = r.putCall === "Put" || r.putCall === "Call" ? r.putCall : null;
    const key = `${cusip}:${putCall ?? ""}`;
    const amount = (r.shrsOrPrnAmt ?? {}) as Record<string, unknown>;
    const value = n(r.value) * (thousands ? 1000 : 1);
    const known = rows.get(key);
    if (known) {
      known.value += value;
      known.shares += n(amount.sshPrnamt);
    } else rows.set(key, { cusip, issuer: String(r.nameOfIssuer ?? "").trim(), title: String(r.titleOfClass ?? "").trim(), value, shares: n(amount.sshPrnamt), putCall });
  }
  return [...rows.values()].sort((a, b) => b.value - a.value);
}

export const fetchFilings = async (cik: number, contact: string | undefined) => parseSubmissions(await httpJson<Submissions>(`${data()}/submissions/CIK${String(cik).padStart(10, "0")}.json`, { headers: headers(contact), timeoutMs: 20_000 }));

/** The holdings of one 13F: its index names the table's file (any .xml but the cover page). */
export async function fetchHoldings(cik: number, filing: Filing, contact: string | undefined): Promise<Holding13F[]> {
  const folder = `${archives()}/Archives/edgar/data/${cik}/${filing.accession.replace(/-/g, "")}`;
  const index = await httpJson<{ directory?: { item?: { name: string }[] } }>(`${folder}/index.json`, { headers: headers(contact), timeoutMs: 20_000 });
  const table = index.directory?.item?.map((i) => i.name).find((name) => /\.xml$/i.test(name) && name.toLowerCase() !== "primary_doc.xml");
  if (!table) throw new Error(`No holdings table in filing ${filing.accession}`);
  const res = await http(`${folder}/${table}`, { headers: headers(contact), timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} from the SEC`);
  return parseInfoTable(await res.text(), filing.filed);
}
