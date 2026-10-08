import { db } from "../db";
import { addTransaction } from "./store";

export const EVERY = ["week", "month", "year"] as const;
export type Every = (typeof EVERY)[number];

/** A transaction that repeats: rent, salary, subscriptions. Due occurrences become real transactions. */
export interface RecurringRule {
  id: number;
  description: string;
  amount_cents: number;
  currency: string;
  category: string | null;
  every: Every;
  /** Every 1 month, every 2 weeks… */
  every_n: number;
  start_date: string;
  end_date: string | null;
  /** Last occurrence already added as a transaction. */
  last_date: string | null;
  active: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => iso(new Date());

/**
 * The k-th step from `start`. Months keep the start's day, clamped to short months (Jan 31 →
 * Feb 28 → Mar 31), so dates never drift.
 */
export function stepDate(start: string, every: Every, k: number): string {
  const [y, m, d] = start.split("-").map(Number);
  if (every === "week") return iso(new Date(Date.UTC(y, m - 1, d + 7 * k)));
  const months = m - 1 + k * (every === "year" ? 12 : 1);
  const last = new Date(Date.UTC(y, months + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, months, Math.min(d, last))));
}

/** Occurrence dates after `after` (exclusive, null = from the start) up to `until` (inclusive). */
export function occurrences(rule: Pick<RecurringRule, "every" | "every_n" | "start_date" | "end_date">, after: string | null, until: string, max = 1000): string[] {
  const out: string[] = [];
  const stop = rule.end_date && rule.end_date < until ? rule.end_date : until;
  for (let k = 0; out.length < max; k++) {
    const d = stepDate(rule.start_date, rule.every, k * Math.max(1, rule.every_n));
    if (d > stop) break;
    if (!after || d > after) out.push(d);
  }
  return out;
}

interface Row extends Omit<RecurringRule, "active"> {
  active: number;
}
const toRule = (r: Row): RecurringRule => ({ ...r, active: !!r.active });

export const listRecurring = () =>
  (db().prepare("SELECT * FROM fin_recurring ORDER BY active DESC, description").all() as unknown as Row[]).map(toRule);

export const getRecurring = (id: number) => {
  const r = db().prepare("SELECT * FROM fin_recurring WHERE id = ?").get(id) as Row | undefined;
  return r && toRule(r);
};

export function createRecurring(r: Omit<RecurringRule, "id" | "last_date" | "active">): RecurringRule {
  const res = db()
    .prepare(
      `INSERT INTO fin_recurring (description, amount_cents, currency, category, every, every_n, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.description, r.amount_cents, r.currency.toUpperCase(), r.category, r.every, r.every_n, r.start_date, r.end_date, Date.now());
  return getRecurring(Number(res.lastInsertRowid))!;
}

export function updateRecurring(id: number, patch: Partial<Pick<RecurringRule, "description" | "amount_cents" | "category" | "end_date" | "active">>) {
  const cols = Object.entries({ ...patch, active: patch.active === undefined ? undefined : patch.active ? 1 : 0 }).filter(([, v]) => v !== undefined);
  if (!cols.length) return;
  db()
    .prepare(`UPDATE fin_recurring SET ${cols.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...cols.map(([, v]) => v as string | number | null), id);
}

/** Stops future occurrences; transactions already added stay. */
export const deleteRecurring = (id: number) => db().prepare("DELETE FROM fin_recurring WHERE id = ?").run(id);

/**
 * Add every due occurrence (up to `until`, default today) as a transaction. Each one has a stable
 * id, so running twice adds nothing; `last_date` keeps deleted ones from coming back.
 */
export function runRecurring(until = today()): number {
  let added = 0;
  for (const rule of listRecurring()) {
    if (!rule.active) continue;
    const due = occurrences(rule, rule.last_date, until, 400);
    if (!due.length) continue;
    db().exec("BEGIN");
    try {
      for (const date of due) {
        const r = addTransaction({
          date,
          amountCents: rule.amount_cents,
          currency: rule.currency,
          description: rule.description,
          category: rule.category,
          source: "recurring",
          externalId: `rec:${rule.id}:${date}`,
        });
        if (r === "added") added++;
      }
      db().prepare("UPDATE fin_recurring SET last_date = ? WHERE id = ?").run(due[due.length - 1], rule.id);
      db().exec("COMMIT");
    } catch (e) {
      db().exec("ROLLBACK");
      throw e;
    }
  }
  return added;
}

/** Hourly: add recurring transactions that came due. */
export async function recurringJob() {
  const n = runRecurring();
  if (n) console.log(`[page] added ${n} recurring transaction${n === 1 ? "" : "s"}`);
}

// --- shortcuts: one-tap transactions ("macros") ---

export interface Shortcut {
  id: number;
  label: string;
  amount_cents: number;
  currency: string;
  category: string | null;
}

export const listShortcuts = () => db().prepare("SELECT id, label, amount_cents, currency, category FROM fin_shortcuts ORDER BY label").all() as unknown as Shortcut[];

export function createShortcut(s: Omit<Shortcut, "id">) {
  db()
    .prepare("INSERT INTO fin_shortcuts (label, amount_cents, currency, category, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(s.label, s.amount_cents, s.currency.toUpperCase(), s.category, Date.now());
}

export const deleteShortcut = (id: number) => db().prepare("DELETE FROM fin_shortcuts WHERE id = ?").run(id);
