import { db, getAppMeta, setAppMeta } from "../db";
import { addTransaction } from "./store";
import { localDay } from "@/lib/day";
import { loadConfig } from "@/lib/config/load";
import { hasAlertChannel, sendNotice } from "@/lib/alerts";

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
  /** Shown in Finance → Subscriptions, with renewal reminders. */
  subscription: boolean;
  url: string | null;
  notes: string | null;
  /** Remind this many days before each renewal; null: no reminder. */
  remind_days: number | null;
  /** Account its transactions go to. */
  account: string | null;
  /** Cancel before this date (a trial ending, a notice period); reminded too. */
  cancel_by: string | null;
}

/** Fields that only describe a subscription (none of them changes the money). */
export type SubscriptionFields = Pick<RecurringRule, "subscription" | "url" | "notes" | "remind_days" | "account" | "cancel_by">;

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => localDay();

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

interface Row extends Omit<RecurringRule, "active" | "subscription"> {
  active: number;
  subscription: number;
}
const toRule = (r: Row): RecurringRule => ({ ...r, active: !!r.active, subscription: !!r.subscription });

export const listRecurring = () =>
  (db().prepare("SELECT * FROM fin_recurring ORDER BY active DESC, description").all() as unknown as Row[]).map(toRule);

export const getRecurring = (id: number) => {
  const r = db().prepare("SELECT * FROM fin_recurring WHERE id = ?").get(id) as Row | undefined;
  return r && toRule(r);
};

export function createRecurring(r: Omit<RecurringRule, "id" | "last_date" | "active" | keyof SubscriptionFields> & Partial<SubscriptionFields>): RecurringRule {
  const res = db()
    .prepare(
      `INSERT INTO fin_recurring (description, amount_cents, currency, category, every, every_n, start_date, end_date, subscription, url, notes, remind_days, account, cancel_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.description,
      r.amount_cents,
      r.currency.toUpperCase(),
      r.category,
      r.every,
      r.every_n,
      r.start_date,
      r.end_date,
      r.subscription ? 1 : 0,
      r.url ?? null,
      r.notes ?? null,
      r.remind_days ?? null,
      r.account ?? null,
      r.cancel_by ?? null,
      Date.now(),
    );
  return getRecurring(Number(res.lastInsertRowid))!;
}

export function updateRecurring(id: number, patch: Partial<Pick<RecurringRule, "description" | "amount_cents" | "category" | "end_date" | "active"> & SubscriptionFields>) {
  const flag = (b: boolean | undefined) => (b === undefined ? undefined : b ? 1 : 0);
  const cols = Object.entries({ ...patch, active: flag(patch.active), subscription: flag(patch.subscription) }).filter(([, v]) => v !== undefined);
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
          account: rule.account,
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
  if (n) console.log(`[nanodash] added ${n} recurring transaction${n === 1 ? "" : "s"}`);
}

// --- subscriptions ---

/** The next date it adds a transaction, or null once it has ended. */
export const nextOccurrence = (r: RecurringRule) => occurrences(r, r.last_date, "9999-12-31", 1)[0] ?? null;

/** What it costs per month on average, in its own currency (positive cents for a payment). */
export function monthlyCents(r: Pick<RecurringRule, "amount_cents" | "every" | "every_n">): number {
  const per = r.every === "week" ? 52 / 12 : r.every === "year" ? 1 / 12 : 1;
  return Math.round((-r.amount_cents * per) / Math.max(1, r.every_n));
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const when = (days: number) => (days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);

/**
 * Hourly: tell the alert channels once per renewal when a subscription renews within its
 * remind_days, and once when its cancel-by date is that close.
 */
export async function subscriptionReminderJob(now = new Date()) {
  const { settings } = loadConfig();
  if (!hasAlertChannel(settings.alerts)) return;
  const day = localDay(now);
  for (const r of listRecurring()) {
    if (!r.subscription || !r.active || r.remind_days === null) continue;
    const next = nextOccurrence(r);
    const notices: { key: string; date: string; message: (left: number) => string; kind: string }[] = [];
    if (next) {
      const amount = (Math.abs(r.amount_cents) / 100).toFixed(2);
      notices.push({ key: `sub:${r.id}:${next}`, date: next, kind: "renewal", message: (left) => `${r.description} renews ${when(left)} (${next}): ${amount} ${r.currency}.` });
    }
    if (r.cancel_by) notices.push({ key: `sub-cancel:${r.id}:${r.cancel_by}`, date: r.cancel_by, kind: "cancel", message: (left) => `Cancel ${r.description} ${when(left)} (by ${r.cancel_by}) if you don't want to keep it.` });
    for (const n of notices) {
      const left = daysBetween(day, n.date);
      if (left < 0 || left > r.remind_days || getAppMeta(n.key)) continue;
      const errors = await sendNotice(settings.alerts, {
        kind: "subscription",
        level: n.kind === "cancel" ? "warn" : "info",
        message: n.message(left),
        subscription: r.description,
        date: n.date,
        days: left,
        amount: Math.abs(r.amount_cents) / 100,
        currency: r.currency,
        url: r.url ?? undefined,
      });
      if (!errors.length) setAppMeta(n.key, true);
    }
  }
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
