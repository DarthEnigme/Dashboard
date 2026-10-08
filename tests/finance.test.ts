import { beforeAll, describe, expect, it } from "vitest";
import { guessMapping, mapRows, parseAmount, parseCsv, parseDate } from "@/lib/finance/csv";
import { freeSlot, summarize, type Txn } from "@/lib/finance/aggregate";
import { mapFirefly } from "@/lib/finance/firefly";

describe("csv", () => {
  it("parses quotes, embedded delimiters and detects ; as delimiter", () => {
    const rows = parseCsv('Date;Libellé;Montant\n02/10/2026;"Café ""Le Coin""; Paris";-3,50\r\n03/10/2026;Salaire;2 500,00\n');
    expect(rows).toEqual([
      ["Date", "Libellé", "Montant"],
      ["02/10/2026", 'Café "Le Coin"; Paris', "-3,50"],
      ["03/10/2026", "Salaire", "2 500,00"],
    ]);
  });

  it("reads amounts in both decimal styles, with signs and parentheses", () => {
    expect(parseAmount("-1.234,56", ",")).toBe(-123456);
    expect(parseAmount("1,234.56", ".")).toBe(123456);
    expect(parseAmount("(12.00)", ".")).toBe(-1200);
    expect(parseAmount("€ 5", ".")).toBe(500);
    expect(parseAmount("", ".")).toBeNull();
  });

  it("reads dates in common formats", () => {
    expect(parseDate("2026-10-03", "auto")).toBe("2026-10-03");
    expect(parseDate("03/10/2026", "auto")).toBe("2026-10-03"); // day-first by default
    expect(parseDate("10/31/2026", "auto")).toBe("2026-10-31"); // 31 can't be a month
    expect(parseDate("10/03/26", "MDY")).toBe("2026-10-03");
    expect(parseDate("31/02/2026", "YMD")).toBeNull();
    expect(parseDate("garbage", "auto")).toBeNull();
  });

  it("maps rows (debit/credit columns), reports bad lines, and gives repeat-stable ids", () => {
    const rows = parseCsv("date,desc,debit,credit\n2026-10-01,Coffee,3.50,\n2026-10-01,Coffee,3.50,\n2026-10-02,Refund,,10\nbad,x,1,\n");
    const m = { date: 0, description: 1, debit: 2, credit: 3, dateFormat: "auto" as const, decimal: "." as const, header: true };
    const a = mapRows(rows, m);
    expect(a.transactions.map((t) => t.amountCents)).toEqual([-350, -350, 1000]);
    // Two identical coffees stay two transactions with different ids…
    expect(new Set(a.transactions.map((t) => t.externalId)).size).toBe(3);
    // …and the same file again yields the same ids (so re-importing adds nothing).
    expect(mapRows(rows, m).transactions.map((t) => t.externalId)).toEqual(a.transactions.map((t) => t.externalId));
    expect(a.errors).toEqual(['Line 5: unreadable date "bad"']);
  });

  it("guesses columns from English and French headers", () => {
    expect(guessMapping(["Date opération", "Libellé", "Montant", "Catégorie"])).toMatchObject({ date: 0, description: 1, amount: 2, category: 3 });
    expect(guessMapping(["Date", "Description", "Debit", "Credit"])).toMatchObject({ debit: 2, credit: 3 });
  });
});

describe("summaries", () => {
  const txns: Txn[] = [
    { date: "2026-09-15", amount_cents: 300000, currency: "EUR", category: "Salary" },
    { date: "2026-10-01", amount_cents: 300000, currency: "EUR", category: "Salary" },
    { date: "2026-10-02", amount_cents: -12000, currency: "EUR", category: "Groceries" },
    { date: "2026-10-05", amount_cents: -80000, currency: "EUR", category: "Rent" },
    { date: "2026-10-06", amount_cents: -2000, currency: "EUR", category: "Hobbies" },
    { date: "2026-10-07", amount_cents: -1000, currency: "EUR", category: null },
    { date: "2026-10-08", amount_cents: -999999, currency: "USD", category: "Rent" },
  ];
  const cats = [
    { name: "Groceries", slot: 1 },
    { name: "Rent", slot: 2 },
    { name: "Hobbies", slot: null },
    { name: "Salary", slot: 3 },
  ];

  it("totals one currency and folds unslotted/uncategorised spending into Other (last)", () => {
    const s = summarize(txns, cats, "2026-10", "EUR");
    expect([s.income, s.expense, s.net, s.count]).toEqual([300000, 95000, 205000, 5]);
    expect(s.categories).toEqual([
      { name: "Rent", cents: 80000, slot: 2 },
      { name: "Groceries", cents: 12000, slot: 1 },
      { name: "Other", cents: 3000, slot: null },
    ]);
    expect(s.period.label).toBe("October 2026");
  });

  it("builds 12 months of totals and a running balance", () => {
    const s = summarize(txns, cats, "2026-10", "EUR");
    expect(s.months).toHaveLength(12);
    expect(s.months.at(-1)).toEqual({ month: "2026-10", income: 300000, expense: 95000 });
    expect(s.balance.at(-2)).toEqual({ month: "2026-09", cents: 300000 });
    expect(s.balance.at(-1)).toEqual({ month: "2026-10", cents: 505000 });
  });

  it("summarises a whole year", () => {
    const s = summarize(txns, cats, "2026", "EUR");
    expect(s.income).toBe(600000);
    expect(s.months[0].month).toBe("2026-01");
  });

  it("hands out free palette slots without reuse", () => {
    expect(freeSlot([{ name: "a", slot: 1 }, { name: "b", slot: 3 }])).toBe(2);
    expect(freeSlot(Array.from({ length: 8 }, (_, i) => ({ name: String(i), slot: i + 1 })))).toBeNull();
  });
});

describe("firefly mapping", () => {
  it("maps withdrawals and deposits, skips transfers", () => {
    const out = mapFirefly([
      { transaction_journal_id: "1", type: "withdrawal", date: "2026-10-02T12:00:00+02:00", amount: "12.30", currency_code: "EUR", description: "Shop", category_name: "Groceries", source_name: "Checking" },
      { transaction_journal_id: "2", type: "deposit", date: "2026-10-01T00:00:00+02:00", amount: "3000", currency_code: "EUR", description: "Salary", category_name: null, destination_name: "Checking" },
      { transaction_journal_id: "3", type: "transfer", date: "2026-10-03", amount: "50", currency_code: "EUR", description: "Savings", category_name: null },
    ]);
    expect(out.map((t) => [t.externalId, t.amountCents, t.date, t.account])).toEqual([
      ["firefly:1", -1230, "2026-10-02", "Checking"],
      ["firefly:2", 300000, "2026-10-01", "Checking"],
    ]);
  });
});

describe("store", () => {
  type Store = typeof import("@/lib/finance/store");
  let store: Store;
  beforeAll(async () => {
    // tests/setup.ts points the database at a fresh temp directory.
    store = await import("@/lib/finance/store");
  });

  it("dedupes imports, assigns slots, renames and merges categories", () => {
    const t = (id: string, cat: string) => ({ date: "2026-10-01", amountCents: -100, currency: "EUR", description: id, category: cat, externalId: id });
    expect(store.importTransactions([t("a", "Food"), t("b", "Fun"), t("a", "Food")])).toEqual({ added: 2, skipped: 1 });
    expect(store.listCategories().map((c) => [c.name, c.slot])).toEqual([["Food", 1], ["Fun", 2]]);

    store.renameCategory("Fun", "food"); // merge into the existing category, case-insensitively
    expect(store.listCategories()).toEqual([{ name: "Food", slot: 1, color: null, budget: null, count: 2 }]);

    store.setCategorySlot("Food", 5);
    expect(store.listCategories()[0].slot).toBe(5);
    expect(store.listTransactions({ q: "a" })).toHaveLength(1);

    store.setCategoryBudget("Food", 25000);
    expect(store.listCategories()[0].budget).toBe(25000);
    store.setCategoryBudget("Food", null);
    expect(store.listCategories()[0].budget).toBeNull();
    expect(() => store.setCategoryBudget("Food", -5)).toThrow();
  });
});
