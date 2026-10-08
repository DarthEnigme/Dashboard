export interface Txn {
  date: string; // YYYY-MM-DD
  amount_cents: number;
  currency: string;
  category: string | null;
  /** Set by convertTxns on amounts it converted. */
  converted?: boolean;
}

export interface CategoryInfo {
  name: string;
  /** Palette slot 1–8, or null: such categories fold into "Other" in charts. */
  slot: number | null;
  /** Monthly spending budget in cents, if one is set. */
  budget?: number | null;
}

export interface Slice {
  name: string;
  cents: number;
  slot: number | null; // null = "Other"
}

export interface MonthTotals {
  month: string; // YYYY-MM
  income: number;
  expense: number; // positive cents
}

/** Where the money came from and where it went, for the Sankey chart. */
export interface Flow {
  /** Income by category, largest first; unslotted income is "Income". */
  sources: Slice[];
  /** Spending by category (same as Summary.categories). */
  sinks: Slice[];
  /** Income left over (0 when spending was higher). */
  saved: number;
  /** Spending not covered by income in the period (0 when income was higher). */
  fromSavings: number;
}

export interface BudgetStatus {
  name: string;
  slot: number | null;
  /** Budget for the period: the monthly budget, ×12 for a year. */
  budget: number;
  spent: number;
}

export interface Summary {
  currency: string;
  period: { from: string; to: string; label: string };
  income: number;
  expense: number;
  net: number;
  count: number;
  /** Spending by category in this period, largest first; categories without a slot fold into "Other". */
  categories: Slice[];
  /** The 12 months ending with this period's last month. */
  months: MonthTotals[];
  /** Running balance at the end of each of those months (all history in this currency). */
  balance: { month: string; cents: number }[];
  flow: Flow;
  /** Categories with a budget, most used first. */
  budgets: BudgetStatus[];
  /** Transactions of this period converted from another currency. */
  converted: number;
  /** Transactions of this period left out: another currency without a rate. */
  skipped: number;
}

const monthOf = (date: string) => date.slice(0, 7);

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * Transactions in `currency`: others are converted with `rates` (units per one `currency`, as from
 * ratesFor), or left out when there is no rate for them.
 */
export function convertTxns(txns: Txn[], currency: string, rates: Record<string, number> = {}): { txns: Txn[]; dropped: Txn[] } {
  const target = currency.toUpperCase();
  const out: Txn[] = [];
  const dropped: Txn[] = [];
  for (const t of txns) {
    const cur = t.currency.toUpperCase();
    if (cur === target) out.push(t);
    else if (rates[cur] > 0) out.push({ ...t, currency: target, amount_cents: Math.round(t.amount_cents / rates[cur]), converted: true });
    else dropped.push(t);
  }
  return { txns: out, dropped };
}

/** Summary for a month ("2026-10") or a year ("2026"), in one currency (see convertTxns for `rates`). */
export function summarize(txns: Txn[], categories: CategoryInfo[], period: string, currency: string, rates?: Record<string, number>): Summary {
  const isYear = /^\d{4}$/.test(period);
  const from = isYear ? `${period}-01-01` : `${period}-01`;
  const lastMonth = isYear ? `${period}-12` : period;
  const to = `${lastMonth}-31`;
  const inRange = (t: Txn) => t.date >= from && t.date <= to;
  const { txns: mine, dropped } = convertTxns(txns, currency, rates);
  const inPeriod = mine.filter(inRange);

  const income = inPeriod.filter((t) => t.amount_cents > 0).reduce((a, t) => a + t.amount_cents, 0);
  const expense = -inPeriod.filter((t) => t.amount_cents < 0).reduce((a, t) => a + t.amount_cents, 0);

  const slots = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const byCat = new Map<string, Slice>();
  for (const t of inPeriod) {
    if (t.amount_cents >= 0) continue;
    const info = t.category ? slots.get(t.category.toLowerCase()) : undefined;
    const name = info?.slot ? info.name : "Other";
    const s = byCat.get(name) ?? { name, cents: 0, slot: info?.slot ?? null };
    s.cents -= t.amount_cents;
    byCat.set(name, s);
  }
  const sorted = [...byCat.values()].sort(otherLast);

  const bySource = new Map<string, Slice>();
  const spentByName = new Map<string, number>();
  for (const t of inPeriod) {
    const info = t.category ? slots.get(t.category.toLowerCase()) : undefined;
    if (t.amount_cents < 0) {
      if (info) spentByName.set(info.name, (spentByName.get(info.name) ?? 0) - t.amount_cents);
      continue;
    }
    const name = info?.slot ? info.name : "Income";
    const s = bySource.get(name) ?? { name, cents: 0, slot: info?.slot ?? null };
    s.cents += t.amount_cents;
    bySource.set(name, s);
  }
  const flow: Flow = {
    sources: [...bySource.values()].filter((s) => s.cents > 0).sort(otherLast),
    sinks: sorted,
    saved: Math.max(0, income - expense),
    fromSavings: Math.max(0, expense - income),
  };
  const budgets = categories
    .filter((c) => c.budget && c.budget > 0)
    .map((c) => ({ name: c.name, slot: c.slot, budget: c.budget! * (isYear ? 12 : 1), spent: spentByName.get(c.name) ?? 0 }))
    .sort((a, b) => b.spent / b.budget - a.spent / a.budget);

  const months = Array.from({ length: 12 }, (_, i) => addMonths(lastMonth, i - 11));
  const monthTotals = months.map((month) => {
    const ts = mine.filter((t) => monthOf(t.date) === month);
    return {
      month,
      income: ts.filter((t) => t.amount_cents > 0).reduce((a, t) => a + t.amount_cents, 0),
      expense: -ts.filter((t) => t.amount_cents < 0).reduce((a, t) => a + t.amount_cents, 0),
    };
  });
  const before = mine.filter((t) => monthOf(t.date) < months[0]).reduce((a, t) => a + t.amount_cents, 0);
  let running = before;
  const balance = monthTotals.map((m) => {
    running += m.income - m.expense;
    return { month: m.month, cents: running };
  });

  const label = isYear
    ? period
    : new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    currency,
    period: { from, to, label },
    income,
    expense,
    net: income - expense,
    count: inPeriod.length,
    categories: sorted,
    months: monthTotals,
    balance,
    flow,
    budgets,
    converted: inPeriod.filter((t) => t.converted).length,
    skipped: dropped.filter(inRange).length,
  };
}

/** Largest first, with the unslotted bucket ("Other", "Income") last. */
const otherLast = (a: Slice, b: Slice) => (a.slot === null ? 1 : b.slot === null ? -1 : b.cents - a.cents);

/** First palette slot (1–8) not used by another category, or null when all eight are taken. */
export function freeSlot(categories: CategoryInfo[]): number | null {
  const used = new Set(categories.map((c) => c.slot));
  for (let s = 1; s <= 8; s++) if (!used.has(s)) return s;
  return null;
}
