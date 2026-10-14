import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { CONFIG_DIR } from "@/lib/config/load";
import { summarize } from "@/lib/finance/aggregate";
import { addRule, categorize, deleteRule, listRules, matchRule, moveRule, ruleMatches } from "@/lib/finance/rules";
import {
  addTransaction,
  allForSummary,
  applyRules,
  deleteCategory,
  ensureCategory,
  importTransactions,
  listCategories,
  listTransactions,
  renameCategory,
  setCategoryBudget,
  setCategoryParent,
} from "@/lib/finance/store";
import { createRecurring, getRecurring, monthlyCents, nextOccurrence, runRecurring, subscriptionReminderJob } from "@/lib/finance/recurring";

beforeEach(() => {
  db().exec("DELETE FROM fin_transactions; DELETE FROM fin_categories; DELETE FROM fin_rules; DELETE FROM fin_recurring; DELETE FROM app_meta WHERE key LIKE 'sub%';");
});

const tx = (description: string, cents: number, category?: string, account?: string) =>
  addTransaction({ date: "2026-10-05", amountCents: cents, currency: "EUR", description, category, account });

describe("category rules", () => {
  it("match by contains, start, exact text or pattern, ignoring case, and per account", () => {
    expect(ruleMatches({ match: "netflix", mode: "contains", account: null }, "NETFLIX.COM 866")).toBe(true);
    expect(ruleMatches({ match: "carte", mode: "starts", account: null }, "CARTE 12/10 LIDL")).toBe(true);
    expect(ruleMatches({ match: "carte", mode: "starts", account: null }, "PRLV CARTE")).toBe(false);
    expect(ruleMatches({ match: "rent", mode: "equals", account: null }, "Rent")).toBe(true);
    expect(ruleMatches({ match: "^amzn|amazon", mode: "regex", account: null }, "AMZN Mktp")).toBe(true);
    expect(ruleMatches({ match: "lidl", mode: "contains", account: "Joint" }, "LIDL", "Personal")).toBe(false);
    expect(ruleMatches({ match: "lidl", mode: "contains", account: "Joint" }, "LIDL", "joint")).toBe(true);
    expect(() => addRule({ match: "(", mode: "regex", category: "X" })).toThrow(/regular expression/);
    expect(() => addRule({ match: "x" })).toThrow(/Category required/);
  });

  it("the first rule wins; order can change", () => {
    const [a] = addRule({ match: "uber eats", category: "Restaurants" });
    addRule({ match: "uber", category: "Transport" });
    expect(matchRule(listRules(), "UBER EATS Paris")?.category).toBe("Restaurants");
    const b = listRules()[1];
    moveRule(b.id, "up");
    expect(matchRule(listRules(), "UBER EATS Paris")?.category).toBe("Transport");
    deleteRule(a.id);
    expect(listRules()).toHaveLength(1);
  });

  it("fill only an empty category, on manual entry, imports and afterwards", () => {
    addRule({ match: "netflix", category: "Subscriptions" });
    expect(categorize({ description: "Netflix", category: "Fun" }).category).toBe("Fun");
    tx("NETFLIX.COM", -1399);
    tx("Netflix gift", -2000, "Gifts");
    importTransactions([{ date: "2026-10-06", amountCents: -1399, currency: "EUR", description: "netflix again", source: "csv", externalId: "csv:1" }]);
    const cats = Object.fromEntries(listTransactions().map((t) => [t.description, t.category]));
    expect(cats).toEqual({ "NETFLIX.COM": "Subscriptions", "Netflix gift": "Gifts", "netflix again": "Subscriptions" });

    // Older transactions: applied on request.
    db().exec("DELETE FROM fin_rules");
    tx("SPOTIFY", -999);
    addRule({ match: "spotify", category: "Subscriptions" });
    expect(applyRules()).toBe(1);
    expect(listTransactions({ q: "SPOTIFY" })[0].category).toBe("Subscriptions");
  });

  it("follow a renamed category, and go when it is deleted", () => {
    addRule({ match: "lidl", category: "Food" });
    renameCategory("Food", "Groceries");
    expect(listRules()[0].category).toBe("Groceries");
    ensureCategory("Groceries");
    deleteCategory("Groceries");
    expect(listRules()).toEqual([]);
  });
});

describe("subcategories", () => {
  it("one level only, and no cycles", () => {
    ensureCategory("Food");
    ensureCategory("Restaurants");
    ensureCategory("Fast food");
    setCategoryParent("Restaurants", "Food");
    expect(() => setCategoryParent("Fast food", "Restaurants")).toThrow(/subcategory itself/);
    expect(() => setCategoryParent("Food", "Fast food")).toThrow(/subcategories of its own/);
    expect(() => setCategoryParent("Food", "Food")).toThrow();
    expect(listCategories().find((c) => c.name === "Restaurants")?.parent).toBe("Food");
    // Renaming the parent keeps the link; deleting it lifts the child to the top level.
    renameCategory("Food", "Eating");
    expect(listCategories().find((c) => c.name === "Restaurants")?.parent).toBe("Eating");
    deleteCategory("Eating");
    expect(listCategories().find((c) => c.name === "Restaurants")?.parent).toBeNull();
  });

  it("roll up into the parent in charts and budgets, and filter with it", () => {
    ensureCategory("Food");
    ensureCategory("Restaurants");
    setCategoryParent("Restaurants", "Food");
    db().exec("UPDATE fin_categories SET slot = NULL, color = NULL WHERE name = 'Restaurants'");
    setCategoryBudget("Food", 30000);
    setCategoryBudget("Restaurants", 10000);
    tx("Lidl", -5000, "Food");
    tx("Bistro", -4000, "Restaurants");
    const s = summarize(allForSummary(), listCategories(), "2026-10", "EUR");
    expect(s.categories.find((c) => c.name === "Food")?.cents).toBe(9000);
    expect(s.categories.find((c) => c.name === "Restaurants")).toBeUndefined();
    expect(Object.fromEntries(s.budgets.map((b) => [b.name, b.spent]))).toEqual({ Food: 9000, Restaurants: 4000 });
    expect(listTransactions({ category: "Food" }).map((t) => t.description).sort()).toEqual(["Bistro", "Lidl"]);
  });
});

describe("subscriptions", () => {
  it("know their next renewal and monthly cost, and post to their account", () => {
    const r = createRecurring({ description: "VPS", amount_cents: -6000, currency: "EUR", category: null, every: "year", every_n: 1, start_date: "2026-01-15", end_date: null, subscription: true, account: "Card" });
    runRecurring("2026-10-14");
    const s = getRecurring(r.id)!;
    expect(nextOccurrence(s)).toBe("2027-01-15");
    expect(monthlyCents(s)).toBe(500);
    expect(monthlyCents({ amount_cents: -1200, every: "week", every_n: 2 })).toBe(2600);
    expect(listTransactions({ q: "VPS" })[0].account).toBe("Card");
  });

  describe("reminders", () => {
    let server: http.Server;
    const hooks: { message: string; kind: string }[] = [];
    const settings = path.join(CONFIG_DIR, "settings.yaml");
    let before: string | undefined;
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => {
          hooks.push(JSON.parse(b));
          res.end("ok");
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      before = fs.existsSync(settings) ? fs.readFileSync(settings, "utf8") : undefined;
      fs.writeFileSync(settings, `title: Test\nalerts:\n  webhook: http://127.0.0.1:${(server.address() as AddressInfo).port}/hook\n`);
    });
    afterAll(() => {
      server.close();
      if (before === undefined) fs.rmSync(settings, { force: true });
      else fs.writeFileSync(settings, before);
    });

    it("go out once per renewal, and once for the cancel-by date", async () => {
      const now = new Date(2026, 9, 14, 12);
      createRecurring({ description: "Netflix", amount_cents: -1399, currency: "EUR", category: null, every: "month", every_n: 1, start_date: "2026-10-16", end_date: null, subscription: true, remind_days: 3 });
      createRecurring({ description: "Trial", amount_cents: -500, currency: "EUR", category: null, every: "month", every_n: 1, start_date: "2026-12-01", end_date: null, subscription: true, remind_days: 2, cancel_by: "2026-10-15" });
      createRecurring({ description: "Far away", amount_cents: -100, currency: "EUR", category: null, every: "year", every_n: 1, start_date: "2027-06-01", end_date: null, subscription: true, remind_days: 3 });
      createRecurring({ description: "Not tracked", amount_cents: -100, currency: "EUR", category: null, every: "month", every_n: 1, start_date: "2026-10-15", end_date: null });
      await subscriptionReminderJob(now);
      await subscriptionReminderJob(now);
      expect(hooks.map((h) => [h.kind, h.message]).sort()).toEqual([
        ["subscription", "Cancel Trial tomorrow (by 2026-10-15) if you don't want to keep it."],
        ["subscription", "Netflix renews in 2 days (2026-10-16): 13.99 EUR."],
      ]);
    });
  });
});
