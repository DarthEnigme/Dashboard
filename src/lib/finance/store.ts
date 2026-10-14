import { db } from "../db";
import { freeSlot, type CategoryInfo, type Txn } from "./aggregate";
import { categorize, listRules, uncategorizedMatches, type Rule } from "./rules";

export interface Transaction extends Txn {
  id: number;
  description: string;
  account: string | null;
  source: "manual" | "csv" | "firefly" | "recurring" | "transfer";
  external_id: string | null;
  /** Shared by both halves of a transfer between own accounts. */
  transfer_id: string | null;
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
  transferId?: string | null;
}

export function listTransactions(filter: { from?: string; to?: string; category?: string; account?: string; q?: string; limit?: number } = {}): Transaction[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const add = (condition: string, ...values: (string | number)[]) => {
    where.push(condition);
    args.push(...values);
  };
  if (filter.from) add("date >= ?", filter.from);
  if (filter.to) add("date <= ?", filter.to);
  if (filter.category === "") add("category IS NULL");
  // A parent category also matches its subcategories.
  else if (filter.category) add("(category = ? COLLATE NOCASE OR category IN (SELECT name FROM fin_categories WHERE parent = ? COLLATE NOCASE))", filter.category, filter.category);
  if (filter.account === "") add("account IS NULL");
  else if (filter.account) add("account = ? COLLATE NOCASE", filter.account);
  if (filter.q) add("(description LIKE ? OR category LIKE ?)", `%${filter.q}%`, `%${filter.q}%`);
  const sql = `SELECT * FROM fin_transactions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY date DESC, id DESC LIMIT ?`;
  return db().prepare(sql).all(...args, filter.limit ?? 1000) as unknown as Transaction[];
}

/**
 * Everything needed for summaries (light columns only), optionally for one account ("" = no
 * account). `recurring` marks transactions added by a recurring rule, `transfer` moves between
 * own accounts.
 */
export const allForSummary = (account?: string) =>
  (
    db()
      .prepare(
        `SELECT date, amount_cents, currency, category, source = 'recurring' AS recurring, transfer_id IS NOT NULL AS transfer FROM fin_transactions${
          account === undefined ? "" : account === "" ? " WHERE account IS NULL" : " WHERE account = ? COLLATE NOCASE"
        }`,
      )
      .all(...(account ? [account] : [])) as unknown as (Omit<Txn, "recurring" | "transfer"> & { recurring: number; transfer: number })[]
  ).map((t): Txn => ({ ...t, recurring: !!t.recurring, transfer: !!t.transfer }));

/** Currencies that transactions use, most used first. */
export const currenciesInUse = () =>
  (db().prepare("SELECT UPPER(currency) AS c FROM fin_transactions GROUP BY UPPER(currency) ORDER BY COUNT(*) DESC").all() as { c: string }[]).map((r) => r.c);

export function listCategories(): (CategoryInfo & { count: number })[] {
  return db()
    .prepare(
      `SELECT c.name, c.slot, c.color, c.parent, c.budget_cents AS budget, (SELECT COUNT(*) FROM fin_transactions t WHERE t.category = c.name COLLATE NOCASE) AS count
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

/** Add a transaction; one without a category gets it from the category rules (not transfers). */
export function addTransaction(input: NewTransaction, rules?: Rule[]): "added" | "duplicate" {
  const t = input.source === "transfer" || input.transferId ? input : categorize(input, rules);
  const category = ensureCategory(t.category);
  const res = db()
    .prepare(
      `INSERT OR IGNORE INTO fin_transactions (date, amount_cents, currency, category, description, account, source, external_id, transfer_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.date,
      t.amountCents,
      t.currency.toUpperCase(),
      category,
      t.description,
      t.account?.trim() || null,
      t.source ?? "manual",
      t.externalId ?? null,
      t.transferId ?? null,
      Date.now(),
    );
  return res.changes ? "added" : "duplicate";
}

export function importTransactions(list: NewTransaction[]): { added: number; skipped: number } {
  let added = 0;
  db().exec("BEGIN");
  try {
    const rules = listRules();
    for (const t of list) if (addTransaction(t, rules) === "added") added++;
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
  if (patch.account !== undefined) cols.push(["account", patch.account?.trim() || null]);
  if (!cols.length) return;
  db()
    .prepare(`UPDATE fin_transactions SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .run(...cols.map(([, v]) => v), id);
}

/** Deleting either half of a transfer deletes both. */
export function deleteTransaction(id: number) {
  const row = db().prepare("SELECT transfer_id FROM fin_transactions WHERE id = ?").get(id) as { transfer_id: string | null } | undefined;
  if (row?.transfer_id) db().prepare("DELETE FROM fin_transactions WHERE transfer_id = ?").run(row.transfer_id);
  else db().prepare("DELETE FROM fin_transactions WHERE id = ?").run(id);
}

/** Fill the category of uncategorised transactions from the rules; returns how many changed. */
export function applyRules(): number {
  const matches = uncategorizedMatches();
  db().exec("BEGIN");
  try {
    for (const m of matches) db().prepare("UPDATE fin_transactions SET category = ? WHERE id = ?").run(ensureCategory(m.category), m.id);
    db().exec("COMMIT");
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
  return matches.length;
}

/** Everything else that names a category by text: rules, recurring payments, shortcuts and subcategories. */
const CATEGORY_REFS = [
  "UPDATE fin_transactions SET category = ? WHERE category = ? COLLATE NOCASE",
  "UPDATE fin_recurring SET category = ? WHERE category = ? COLLATE NOCASE",
  "UPDATE fin_shortcuts SET category = ? WHERE category = ? COLLATE NOCASE",
  "UPDATE fin_rules SET category = ? WHERE category = ? COLLATE NOCASE",
  "UPDATE fin_categories SET parent = ? WHERE parent = ? COLLATE NOCASE",
];

/** Rename a category, or merge it into another one when the new name exists. */
export function renameCategory(from: string, to: string) {
  const target = to.trim();
  if (!target) throw new Error("Category name required");
  const exists = db().prepare("SELECT name FROM fin_categories WHERE name = ?").get(target) as { name: string } | undefined;
  db().exec("BEGIN");
  try {
    const name = exists && exists.name.toLowerCase() !== from.toLowerCase() ? exists.name : target;
    if (name === target) db().prepare("UPDATE fin_categories SET name = ? WHERE name = ?").run(target, from);
    else db().prepare("DELETE FROM fin_categories WHERE name = ?").run(from);
    for (const sql of CATEGORY_REFS) db().prepare(sql).run(name, from);
    // Merged into its own child, or the other way round: no category is its own parent.
    db().prepare("UPDATE fin_categories SET parent = NULL WHERE parent = name COLLATE NOCASE").run();
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

/** Own chart colour (#rrggbb), or null to go back to the palette slot. */
export function setCategoryColor(name: string, color: string | null) {
  if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Colour must be #rrggbb");
  db().prepare("UPDATE fin_categories SET color = ? WHERE name = ?").run(color?.toLowerCase() ?? null, name);
}

/** Monthly spending budget in cents; null or 0 removes it. */
export function setCategoryBudget(name: string, cents: number | null) {
  if (cents !== null && (!Number.isInteger(cents) || cents < 0)) throw new Error("Budget must be a positive amount");
  db().prepare("UPDATE fin_categories SET budget_cents = ? WHERE name = ?").run(cents || null, name);
}

/**
 * Put a category under another one (null: top level). One level only: a parent can't have a
 * parent itself, and a category with subcategories can't become one.
 */
export function setCategoryParent(name: string, parent: string | null) {
  const p = parent?.trim() || null;
  if (p) {
    if (p.toLowerCase() === name.toLowerCase()) throw new Error("A category can't be its own parent");
    const target = db().prepare("SELECT name, parent FROM fin_categories WHERE name = ?").get(p) as { name: string; parent: string | null } | undefined;
    if (!target) throw new Error("No such parent category");
    if (target.parent) throw new Error(`${target.name} is a subcategory itself`);
    const children = db().prepare("SELECT COUNT(*) AS n FROM fin_categories WHERE parent = ? COLLATE NOCASE").get(name) as { n: number };
    if (children.n) throw new Error(`${name} has subcategories of its own`);
    db().prepare("UPDATE fin_categories SET parent = ? WHERE name = ?").run(target.name, name);
  } else db().prepare("UPDATE fin_categories SET parent = NULL WHERE name = ?").run(name);
}

export function deleteCategory(name: string) {
  db().prepare("UPDATE fin_transactions SET category = NULL WHERE category = ? COLLATE NOCASE").run(name);
  db().prepare("UPDATE fin_recurring SET category = NULL WHERE category = ? COLLATE NOCASE").run(name);
  db().prepare("UPDATE fin_shortcuts SET category = NULL WHERE category = ? COLLATE NOCASE").run(name);
  db().prepare("DELETE FROM fin_rules WHERE category = ? COLLATE NOCASE").run(name);
  // Its subcategories move up to the top level.
  db().prepare("UPDATE fin_categories SET parent = NULL WHERE parent = ? COLLATE NOCASE").run(name);
  db().prepare("DELETE FROM fin_categories WHERE name = ?").run(name);
}

export const getMeta = (key: string) =>
  (db().prepare("SELECT value FROM fin_meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
export const setMeta = (key: string, value: string) =>
  db().prepare("INSERT OR REPLACE INTO fin_meta (key, value) VALUES (?, ?)").run(key, value);
