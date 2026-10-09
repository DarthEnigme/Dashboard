import crypto from "node:crypto";
import { db } from "../db";
import { convertTxns, type Txn } from "./aggregate";
import { addTransaction } from "./store";

export const ACCOUNT_KINDS = ["bank", "cash", "card", "savings", "other"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  currency: string;
  opening_cents: number;
  archived: boolean;
}

export interface AccountWithBalance extends Account {
  /** Opening balance plus every transaction in the account, in its currency. */
  balance: number;
  transactions: number;
  /** Balance at the end of each of the last 12 months, oldest first. */
  history: { month: string; cents: number }[];
  /** Transactions in another currency without an exchange rate, left out of the balance. */
  skipped: number;
}

type Row = Omit<Account, "archived"> & { archived: number };
const toAccount = (r: Row): Account => ({ ...r, archived: !!r.archived });

/**
 * Accounts named on transactions (Firefly III, CSV imports) but not created here yet: add them,
 * in the currency most of their transactions use.
 */
export function seedAccounts(fallbackCurrency: string) {
  const missing = db()
    .prepare(
      `SELECT account AS name,
        (SELECT UPPER(currency) FROM fin_transactions t2 WHERE t2.account = t.account COLLATE NOCASE GROUP BY UPPER(currency) ORDER BY COUNT(*) DESC LIMIT 1) AS currency
       FROM fin_transactions t
       WHERE account IS NOT NULL AND account != '' AND NOT EXISTS (SELECT 1 FROM fin_accounts a WHERE a.name = t.account COLLATE NOCASE)
       GROUP BY account COLLATE NOCASE`,
    )
    .all() as { name: string; currency: string | null }[];
  const insert = db().prepare("INSERT OR IGNORE INTO fin_accounts (name, kind, currency, created_at) VALUES (?, 'bank', ?, ?)");
  for (const m of missing) insert.run(m.name, m.currency ?? fallbackCurrency.toUpperCase(), Date.now());
}

export function listAccounts(): Account[] {
  return (db().prepare("SELECT id, name, kind, currency, opening_cents, archived FROM fin_accounts ORDER BY archived, name COLLATE NOCASE").all() as unknown as Row[]).map(toAccount);
}

export function getAccount(id: number): Account | undefined {
  const r = db().prepare("SELECT id, name, kind, currency, opening_cents, archived FROM fin_accounts WHERE id = ?").get(id) as Row | undefined;
  return r && toAccount(r);
}

const monthOf = (d: string) => d.slice(0, 7);

/** Balances per account. `rates` (units per one unit of each account's currency) convert other currencies. */
export function withBalances(accounts: Account[], ratesFor: (currency: string) => Record<string, number> | undefined, today = new Date().toISOString().slice(0, 10)): AccountWithBalance[] {
  const rows = db().prepare("SELECT account, date, amount_cents, currency, category FROM fin_transactions WHERE account IS NOT NULL").all() as unknown as (Txn & { account: string })[];
  const byAccount = new Map<string, Txn[]>();
  for (const r of rows) {
    const k = r.account.toLowerCase();
    byAccount.set(k, [...(byAccount.get(k) ?? []), r]);
  }
  const now = monthOf(today);
  const [y, m] = now.split("-").map(Number);
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 12 + i, 1)).toISOString().slice(0, 7));
  return accounts.map((a) => {
    const own = byAccount.get(a.name.toLowerCase()) ?? [];
    const { txns, dropped } = convertTxns(own, a.currency, ratesFor(a.currency));
    const upTo = (end: string) => a.opening_cents + txns.filter((t) => t.date <= end).reduce((s, t) => s + t.amount_cents, 0);
    return {
      ...a,
      balance: upTo(today),
      transactions: own.length,
      history: months.map((month) => ({ month, cents: upTo(month === now ? today : `${month}-31`) })),
      skipped: dropped.length,
    };
  });
}

function cleanName(name: unknown): string {
  const n = typeof name === "string" ? name.trim().slice(0, 60) : "";
  if (!n) throw new Error("Account name required");
  return n;
}

export function createAccount(a: { name: unknown; kind?: unknown; currency: string; openingCents?: number }): Account {
  const name = cleanName(a.name);
  if (db().prepare("SELECT 1 FROM fin_accounts WHERE name = ?").get(name)) throw new Error(`There is already an account called ${name}`);
  const kind = ACCOUNT_KINDS.includes(a.kind as AccountKind) ? (a.kind as AccountKind) : "bank";
  const r = db()
    .prepare("INSERT INTO fin_accounts (name, kind, currency, opening_cents, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(name, kind, a.currency.toUpperCase(), a.openingCents ?? 0, Date.now());
  return getAccount(Number(r.lastInsertRowid))!;
}

/** Renaming also renames the account on its transactions (they reference it by name). */
export function updateAccount(id: number, patch: { name?: unknown; kind?: unknown; currency?: string; openingCents?: number; archived?: boolean }) {
  const current = getAccount(id);
  if (!current) throw new Error("No such account");
  db().exec("BEGIN");
  try {
    if (patch.name !== undefined) {
      const name = cleanName(patch.name);
      const clash = db().prepare("SELECT id FROM fin_accounts WHERE name = ? AND id != ?").get(name, id);
      if (clash) throw new Error(`There is already an account called ${name}`);
      db().prepare("UPDATE fin_accounts SET name = ? WHERE id = ?").run(name, id);
      db().prepare("UPDATE fin_transactions SET account = ? WHERE account = ? COLLATE NOCASE").run(name, current.name);
    }
    if (patch.kind !== undefined && ACCOUNT_KINDS.includes(patch.kind as AccountKind)) db().prepare("UPDATE fin_accounts SET kind = ? WHERE id = ?").run(patch.kind as string, id);
    if (patch.currency !== undefined) db().prepare("UPDATE fin_accounts SET currency = ? WHERE id = ?").run(patch.currency.toUpperCase(), id);
    if (patch.openingCents !== undefined) db().prepare("UPDATE fin_accounts SET opening_cents = ? WHERE id = ?").run(patch.openingCents, id);
    if (patch.archived !== undefined) db().prepare("UPDATE fin_accounts SET archived = ? WHERE id = ?").run(patch.archived ? 1 : 0, id);
    db().exec("COMMIT");
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
}

/** Only empty accounts can be deleted; archive the others (they'd come back from their transactions). */
export function deleteAccount(id: number) {
  const a = getAccount(id);
  if (!a) return;
  const used = db().prepare("SELECT COUNT(*) AS n FROM fin_transactions WHERE account = ? COLLATE NOCASE").get(a.name) as { n: number };
  if (used.n) throw new Error(`${a.name} has ${used.n} transactions: archive it instead`);
  db().prepare("DELETE FROM fin_accounts WHERE id = ?").run(id);
}

/**
 * Move money between two own accounts: −amount on `from`, +amount on `to` (`toCents` when the
 * accounts use different currencies). Both halves share a transfer id.
 */
export function transfer(t: { from: number; to: number; date: string; cents: number; toCents?: number; note?: string }): string {
  const from = getAccount(t.from);
  const to = getAccount(t.to);
  if (!from || !to) throw new Error("Pick two accounts");
  if (from.id === to.id) throw new Error("Pick two different accounts");
  if (!Number.isInteger(t.cents) || t.cents <= 0) throw new Error("Amount must be positive");
  const sameCurrency = from.currency === to.currency;
  const received = sameCurrency ? t.cents : t.toCents;
  if (!received || received <= 0) throw new Error(`Enter the amount received in ${to.currency}`);
  const id = crypto.randomUUID();
  const note = t.note?.trim().slice(0, 200);
  db().exec("BEGIN");
  try {
    addTransaction({ date: t.date, amountCents: -t.cents, currency: from.currency, description: note || `Transfer to ${to.name}`, account: from.name, source: "transfer", transferId: id });
    addTransaction({ date: t.date, amountCents: received, currency: to.currency, description: note || `Transfer from ${from.name}`, account: to.name, source: "transfer", transferId: id });
    db().exec("COMMIT");
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
  return id;
}
