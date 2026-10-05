import { httpJson, trimSlash } from "../http";
import { findService } from "../config/lookup";
import { loadConfig } from "../config/load";
import { getMeta, importTransactions, setMeta, type NewTransaction } from "./store";

interface FireflySplit {
  transaction_journal_id: string;
  type: "withdrawal" | "deposit" | "transfer" | string;
  date: string;
  amount: string;
  currency_code: string;
  description: string;
  category_name: string | null;
  source_name?: string | null;
  destination_name?: string | null;
}

interface FireflyPage {
  data: { attributes: { transactions: FireflySplit[] } }[];
  meta: { pagination: { current_page: number; total_pages: number } };
}

/** Withdrawals are spending, deposits income; transfers between own accounts are skipped. */
export function mapFirefly(splits: FireflySplit[]): NewTransaction[] {
  return splits
    .filter((s) => s.type === "withdrawal" || s.type === "deposit")
    .map((s) => {
      const cents = Math.round(Math.abs(Number(s.amount)) * 100);
      return {
        date: s.date.slice(0, 10),
        amountCents: s.type === "withdrawal" ? -cents : cents,
        currency: s.currency_code,
        description: s.description,
        category: s.category_name,
        account: s.type === "withdrawal" ? (s.source_name ?? null) : (s.destination_name ?? null),
        source: "firefly" as const,
        externalId: `firefly:${s.transaction_journal_id}`,
      };
    });
}

const LAST_SYNC = "firefly.lastSync";

/** Pull transactions (all of them the first time, then the last 60 days) and add new ones. */
export async function syncFirefly(): Promise<{ added: number; skipped: number }> {
  const serviceId = loadConfig().settings.finance.fireflyService;
  if (!serviceId) throw new Error("Set finance.fireflyService in settings to the id of your Firefly III service");
  const widget = (await findService(serviceId))?.widget as { type: string; url?: string; token?: string; insecure?: boolean } | undefined;
  if (widget?.type !== "firefly" || !widget.url || !widget.token) throw new Error(`"${serviceId}" is not a configured Firefly III widget`);

  const last = getMeta(LAST_SYNC);
  const start = last ? new Date(Date.parse(last) - 60 * 86_400_000).toISOString().slice(0, 10) : "1970-01-01";
  const end = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const splits: FireflySplit[] = [];
  for (let page = 1, total = 1; page <= total && page <= 200; page++) {
    const q = new URLSearchParams({ start, end, type: "all", page: String(page), limit: "200" });
    const r = await httpJson<FireflyPage>(`${trimSlash(widget.url)}/api/v1/transactions?${q}`, {
      insecure: widget.insecure,
      headers: { Authorization: `Bearer ${widget.token}` },
      timeoutMs: 20_000,
    });
    splits.push(...r.data.flatMap((g) => g.attributes.transactions));
    total = r.meta.pagination.total_pages;
  }
  const result = importTransactions(mapFirefly(splits));
  setMeta(LAST_SYNC, new Date().toISOString());
  return result;
}

export const lastFireflySync = () => getMeta(LAST_SYNC) ?? null;

/** Daily sync, called from the monitor's hourly pass. */
export async function fireflyDailyJob() {
  if (!loadConfig().settings.finance.fireflyService) return;
  const last = getMeta(LAST_SYNC);
  if (last && Date.now() - Date.parse(last) < 23 * 3_600_000) return;
  await syncFirefly();
}
