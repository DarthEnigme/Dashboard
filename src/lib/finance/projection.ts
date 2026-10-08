import type { Txn } from "./aggregate";
import { occurrences, type RecurringRule } from "./recurring";

export interface ProjectionMonth {
  month: string; // YYYY-MM
  /** Expected balance at the end of the month. */
  cents: number;
  /** Recurring transactions expected in the month (net). */
  recurring: number;
}

export interface Projection {
  /** Balance today (every transaction up to today). */
  balance: number;
  /** Average monthly net of everything that is not recurring, over the last three full months. */
  variable: number;
  /** Net of the recurring transactions in a typical month (the next full month). */
  recurring: number;
  /** This month and the next `months - 1`. */
  months: ProjectionMonth[];
  /** Actual balance at the end of each of the 6 months before this one. */
  history: { month: string; cents: number }[];
}

const monthOf = (d: string) => d.slice(0, 7);
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * Where the balance is heading: today's balance, plus the recurring rules' occurrences, plus the
 * average of everything else (groceries, one-offs) from the last three full months. Transactions
 * already dated in the future count in their month. All amounts in one currency.
 */
export function project(
  txns: (Txn & { recurring?: boolean })[],
  rules: Pick<RecurringRule, "amount_cents" | "every" | "every_n" | "start_date" | "end_date" | "last_date" | "active">[],
  today: string,
  months = 12,
): Projection {
  const thisMonth = monthOf(today);
  const balance = txns.filter((t) => t.date <= today).reduce((a, t) => a + t.amount_cents, 0);

  // Only months since the first transaction count, so a new tracker doesn't average in empty months.
  const first = txns.reduce<string | undefined>((a, t) => (!a || t.date < a ? t.date : a), undefined);
  const past = [1, 2, 3].map((n) => addMonths(thisMonth, -n)).filter((m) => first && m >= monthOf(first));
  const variable = past.length
    ? Math.round(txns.filter((t) => !t.recurring && past.includes(monthOf(t.date))).reduce((a, t) => a + t.amount_cents, 0) / past.length)
    : 0;

  const active = rules.filter((r) => r.active);
  // Occurrences not yet added as transactions (from the day after the last one added).
  const recurringIn = (from: string, to: string) =>
    active.reduce((a, r) => a + occurrences(r, r.last_date && r.last_date > from ? r.last_date : from, to).length * r.amount_cents, 0);
  const futureIn = (from: string, to: string) => txns.filter((t) => t.date > from && t.date <= to).reduce((a, t) => a + t.amount_cents, 0);

  const [y, m, d] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: ProjectionMonth[] = [];
  let running = balance;
  for (let i = 0; i < months; i++) {
    const month = addMonths(thisMonth, i);
    const from = i === 0 ? today : monthEnd(addMonths(month, -1));
    const to = monthEnd(month);
    const rec = recurringIn(from, to);
    const share = i === 0 ? (daysInMonth - d) / daysInMonth : 1;
    running += rec + futureIn(from, to) + Math.round(variable * share);
    out.push({ month, cents: running, recurring: rec });
  }
  const history = [6, 5, 4, 3, 2, 1].map((n) => {
    const month = addMonths(thisMonth, -n);
    const end = monthEnd(month);
    return { month, cents: txns.filter((t) => t.date <= end).reduce((a, t) => a + t.amount_cents, 0) };
  });
  return { balance, variable, recurring: out[1]?.recurring ?? out[0]?.recurring ?? 0, months: out, history };
}
