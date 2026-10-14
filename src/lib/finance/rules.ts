import { db } from "../db";

/**
 * Category rules: "description contains NETFLIX → Subscriptions". They only fill an empty
 * category (a category set by hand, by the CSV or by Firefly always wins), and the first rule that
 * matches, in priority order, is the one used.
 */
export const RULE_MODES = ["contains", "starts", "equals", "regex"] as const;
export type RuleMode = (typeof RULE_MODES)[number];

export interface Rule {
  id: number;
  match: string;
  mode: RuleMode;
  category: string;
  /** Only for transactions of this account; null for all. */
  account: string | null;
  priority: number;
}

/** Rules in the order they are tried. */
export function listRules(): Rule[] {
  return db().prepare("SELECT id, match, mode, category, account, priority FROM fin_rules ORDER BY priority, id").all() as unknown as Rule[];
}

function clean(b: Record<string, unknown>): Omit<Rule, "id" | "priority"> {
  const match = typeof b.match === "string" ? b.match.trim() : "";
  const category = typeof b.category === "string" ? b.category.trim() : "";
  const mode = (RULE_MODES as readonly string[]).includes(b.mode as string) ? (b.mode as RuleMode) : "contains";
  if (!match) throw new Error("Text to match required");
  if (match.length > 200) throw new Error("Text to match: at most 200 characters");
  if (!category) throw new Error("Category required");
  if (mode === "regex") {
    try {
      new RegExp(match, "i");
    } catch {
      throw new Error("Not a valid regular expression");
    }
  }
  const account = typeof b.account === "string" && b.account.trim() ? b.account.trim() : null;
  return { match, mode, category, account };
}

export function addRule(b: Record<string, unknown>): Rule[] {
  const r = clean(b);
  const last = (db().prepare("SELECT MAX(priority) AS p FROM fin_rules").get() as { p: number | null }).p ?? 0;
  db()
    .prepare("INSERT INTO fin_rules (match, mode, category, account, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(r.match, r.mode, r.category, r.account, last + 1, Date.now());
  return listRules();
}

export function updateRule(id: number, b: Record<string, unknown>): Rule[] {
  const r = clean(b);
  db().prepare("UPDATE fin_rules SET match = ?, mode = ?, category = ?, account = ? WHERE id = ?").run(r.match, r.mode, r.category, r.account, id);
  return listRules();
}

export function deleteRule(id: number): Rule[] {
  db().prepare("DELETE FROM fin_rules WHERE id = ?").run(id);
  return listRules();
}

/** Move a rule one place up (tried earlier) or down. */
export function moveRule(id: number, dir: "up" | "down"): Rule[] {
  const list = listRules();
  const i = list.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  const set = db().prepare("UPDATE fin_rules SET priority = ? WHERE id = ?");
  list.forEach((r, k) => set.run(k + 1, r.id));
  return listRules();
}

export function ruleMatches(r: Pick<Rule, "match" | "mode" | "account">, description: string, account?: string | null): boolean {
  if (r.account && r.account.toLowerCase() !== (account ?? "").toLowerCase()) return false;
  const d = description.toLowerCase();
  const m = r.match.toLowerCase();
  switch (r.mode) {
    case "starts":
      return d.startsWith(m);
    case "equals":
      return d.trim() === m;
    case "regex":
      try {
        return new RegExp(r.match, "i").test(description);
      } catch {
        return false;
      }
    default:
      return d.includes(m);
  }
}

/** The first rule that matches, if any. */
export function matchRule(rules: Rule[], description: string, account?: string | null): Rule | undefined {
  return rules.find((r) => ruleMatches(r, description, account));
}

/** The category rules give a transaction that has none; a category it already has is kept. */
export function categorize<T extends { description: string; category?: string | null; account?: string | null }>(t: T, rules = listRules()): T {
  if (t.category?.trim()) return t;
  const r = matchRule(rules, t.description, t.account);
  return r ? { ...t, category: r.category } : t;
}

/** Transactions without a category that the rules would fill. */
export function uncategorizedMatches(rules = listRules()): { id: number; category: string }[] {
  if (!rules.length) return [];
  const rows = db().prepare("SELECT id, description, account FROM fin_transactions WHERE category IS NULL AND transfer_id IS NULL").all() as unknown as {
    id: number;
    description: string;
    account: string | null;
  }[];
  return rows.flatMap((t) => {
    const r = matchRule(rules, t.description, t.account);
    return r ? [{ id: t.id, category: r.category }] : [];
  });
}
