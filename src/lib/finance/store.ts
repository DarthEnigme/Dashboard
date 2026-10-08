import { db } from "../db";
import { freeSlot, type CategoryInfo, type Txn } from "./aggregate";

export interface Transaction extends Txn {
  id: number;
  description: string;
  account: string | null;
  source: "manual" | "csv" | "firefly";
  external_id: string | null;
}

export interface NewTransaction {
  date: string;
  amountCents: number;
  currency: string;
  description: string;
  category?: string | null;
  account?: string | null;
  source?: Transaction["source"];
  externalId?: string | null;
}

export function listTransactions(filter: { from?: string; to?: string; category?: string; q?: string; limit?: number } = {}): Transaction[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.from) where.push("date >= ?"), args.push(filter.from);
  if (filter.to) where.push("date <= ?"), args.push(filter.to);
  if (filter.category === "") where.push("category IS NULL");
  else if (filter.category) where.push("category = ? COLLATE NOCASE"), args.push(filter.category);
  if (filter.q) where.push("(description LIKE ? OR category LIKE ?)"), args.push(`%${filter.q}%`, `%${filter.q}%`);
  const sql = `SELECT * FROM fin_transactions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY date DESC, id DESC LIMIT ?`;
  return db().prepare(sql).all(...args, filter.limit ?? 1000) as unknown as Transaction[];
}

/** Everything needed for summaries (light columns only). */
export const allForSummary = () =>
  db().prepare("SELECT date, amount_cents, currency, category FROM fin_transactions").all() as unknown as Txn[];

/** Currencies that transactions use, most used first. */
export const currenciesInUse = () =>
  (db().prepare("SELECT UPPER(currency) AS c FROM fin_transactions GROUP BY UPPER(currency) ORDER BY COUNT(*) DESC").all() as { c: string }[]).map((r) => r.c);

export function listCategories(): (CategoryInfo & { count: number })[] {
  return db()
    .prepare(
      `SELECT c.name, c.slot, c.budget_cents AS budget, (SELECT COUNT(*) FROM fin_transactions t WHERE t.category = c.name COLLATE NOCASE) AS count
       FROM fin_categories c ORDER BY c.slot IS NULL, c.slot, c.name`,
    )
    .all() as unknown as (CategoryInfo & { count: number })[];
}

/** Make sure a category exists; new ones get the first free palette slot (never a reused one). */
export function ensureCategory(name: string | null | undefined): string | null {
  const n = name?.trim();
  if (!n) return null;
  const existing = db().prepare("SELECT name FROM fin_categories WHERE name = ?").get(n) as { name: string } | undefined;
  if (existing) return existing.name;
  db().prepare("INSERT INTO fin_categories (name, slot) VALUES (?, ?)").run(n, freeSlot(listCategories()));
  return n;
}

export function addTransaction(t: NewTransaction): "added" | "duplicate" {
  const category = ensureCategory(t.category);
  const res = db()
    .prepare(
      `INSERT OR IGNORE INTO fin_transactions (date, amount_cents, currency, category, description, account, source, external_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.date, t.amountCents, t.currency.toUpperCase(), category, t.description, t.account ?? null, t.source ?? "manual", t.externalId ?? null, Date.now());
  return res.changes ? "added" : "duplicate";
}

export function importTransactions(list: NewTransaction[]): { added: number; skipped: number } {
  let added = 0;
  db().exec("BEGIN");
  try {
    for (const t of list) if (addTransaction(t) === "added") added++;
    db().exec("COMMIT");
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
  return { added, skipped: list.length - added };
}

export function updateTransaction(id: number, patch: Partial<NewTransaction>) {
  const cols: [string, string | number | null][] = [];
  if (patch.date !== undefined) cols.push(["date", patch.date]);
  if (patch.amountCents !== undefined) cols.push(["amount_cents", patch.amountCents]);
  if (patch.description !== undefined) cols.push(["description", patch.description]);
  if (patch.category !== undefined) cols.push(["category", ensureCategory(patch.category)]);
  if (!cols.length) return;
  db()
    .prepare(`UPDATE fin_transactions SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .run(...cols.map(([, v]) => v), id);
}

export const deleteTransaction = (id: number) => db().prepare("DELETE FROM fin_transactions WHERE id = ?").run(id);

/** Rename a category, or merge it into another one when the new name exists. */
export function renameCategory(from: string, to: string) {
  const target = to.trim();
  if (!target) throw new Error("Category name required");
  const exists = db().prepare("SELECT name FROM fin_categories WHERE name = ?").get(target) as { name: string } | undefined;
  db().exec("BEGIN");
  try {
    if (exists && exists.name.toLowerCase() !== from.toLowerCase()) {
      db().prepare("UPDATE fin_transactions SET category = ? WHERE category = ? COLLATE NOCASE").run(exists.name, from);
      db().prepare("DELETE FROM fin_categories WHERE name = ?").run(from);
    } else {
      db().prepare("UPDATE fin_categories SET name = ? WHERE name = ?").run(target, from);
      db().prepare("UPDATE fin_transactions SET category = ? WHERE category = ? COLLATE NOCASE").run(target, from);
    }
    db().exec("COMMIT");
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
}

/** Give a category a palette slot; whoever held that slot loses it (and folds into "Other"). */
export function setCategorySlot(name: string, slot: number | null) {
  if (slot !== null && (slot < 1 || slot > 8)) throw new Error("Slot must be 1–8");
  if (slot !== null) db().prepare("UPDATE fin_categories SET slot = NULL WHERE slot = ?").run(slot);
  db().prepare("UPDATE fin_categories SET slot = ? WHERE name = ?").run(slot, name);
}

/** Monthly spending budget in cents; null or 0 removes it. */
export function setCategoryBudget(name: string, cents: number | null) {
  if (cents !== null && (!Number.isInteger(cents) || cents < 0)) throw new Error("Budget must be a positive amount");
  db().prepare("UPDATE fin_categories SET budget_cents = ? WHERE name = ?").run(cents || null, name);
}

export function deleteCategory(name: string) {
  db().prepare("UPDATE fin_transactions SET category = NULL WHERE category = ? COLLATE NOCASE").run(name);
  db().prepare("DELETE FROM fin_categories WHERE name = ?").run(name);
}

export const getMeta = (key: string) =>
  (db().prepare("SELECT value FROM fin_meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
export const setMeta = (key: string, value: string) =>
  db().prepare("INSERT OR REPLACE INTO fin_meta (key, value) VALUES (?, ?)").run(key, value);
