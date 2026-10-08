import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRecurring, deleteRecurring, getRecurring, occurrences, runRecurring, stepDate, updateRecurring } from "@/lib/finance/recurring";
import { project } from "@/lib/finance/projection";
import { createGoal, listGoals, monthlyNeeded, moveToGoal } from "@/lib/finance/goals";
import { colIndex, readXlsx, serialToDate } from "@/lib/finance/xlsx";
import { guessMapping, mapRows } from "@/lib/finance/csv";
import { summarize, type Txn } from "@/lib/finance/aggregate";
import { listTransactions, deleteTransaction } from "@/lib/finance/store";
import { hasAlertChannel, sendNotice } from "@/lib/alerts";
import { niceRange } from "@/components/charts/common";

describe("recurring dates", () => {
  it("keeps the day of month, clamped to short months, without drifting", () => {
    const monthly = [0, 1, 2, 3].map((k) => stepDate("2026-01-31", "month", k));
    expect(monthly).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(stepDate("2024-02-29", "year", 1)).toBe("2025-02-28");
    expect(stepDate("2026-12-28", "week", 1)).toBe("2027-01-04");
  });

  it("lists occurrences after a date, every n, up to the end date", () => {
    const rule = { every: "week" as const, every_n: 2, start_date: "2026-10-01", end_date: "2026-11-10" };
    expect(occurrences(rule, null, "2026-12-31")).toEqual(["2026-10-01", "2026-10-15", "2026-10-29"]);
    expect(occurrences(rule, "2026-10-15", "2026-12-31")).toEqual(["2026-10-29"]);
  });
});

describe("recurring transactions", () => {
  it("fills in past occurrences once, and never brings back a deleted one", () => {
    const rule = createRecurring({ description: "Rent", amount_cents: -80000, currency: "EUR", category: "Home", every: "month", every_n: 1, start_date: "2026-08-05", end_date: null });
    expect(runRecurring("2026-10-08")).toBe(3);
    expect(runRecurring("2026-10-08")).toBe(0);
    const added = listTransactions({ q: "Rent" });
    expect(added.map((t) => [t.date, t.amount_cents, t.source])).toEqual([
      ["2026-10-05", -80000, "recurring"],
      ["2026-09-05", -80000, "recurring"],
      ["2026-08-05", -80000, "recurring"],
    ]);
    deleteTransaction(added[0].id);
    expect(runRecurring("2026-10-08")).toBe(0);
    expect(getRecurring(rule.id)?.last_date).toBe("2026-10-05");

    // Paused rules add nothing; resumed ones catch up.
    updateRecurring(rule.id, { active: false });
    expect(runRecurring("2026-12-08")).toBe(0);
    updateRecurring(rule.id, { active: true });
    expect(runRecurring("2026-12-08")).toBe(2);
    deleteRecurring(rule.id);
    expect(listTransactions({ q: "Rent" })).toHaveLength(4); // what it added stays
  });
});

describe("projection", () => {
  const txns: (Txn & { recurring?: boolean })[] = [
    { date: "2026-06-30", amount_cents: 100000, currency: "EUR", category: null },
    // Three full months of "everything else": -300 a month on average.
    { date: "2026-07-15", amount_cents: -20000, currency: "EUR", category: null },
    { date: "2026-08-15", amount_cents: -30000, currency: "EUR", category: null },
    { date: "2026-09-15", amount_cents: -40000, currency: "EUR", category: null },
    { date: "2026-09-25", amount_cents: 250000, currency: "EUR", category: null, recurring: true },
  ];
  const salary = { amount_cents: 250000, every: "month" as const, every_n: 1, start_date: "2026-07-25", end_date: null, last_date: "2026-09-25", active: true };

  it("adds recurring occurrences and the average of the rest", () => {
    const p = project(txns, [salary], "2026-10-15", 3);
    expect(p.balance).toBe(260000);
    expect(p.variable).toBe(-30000);
    // October: salary on the 25th + about half a month of the rest (16 of 31 days left).
    expect(p.months[0]).toEqual({ month: "2026-10", cents: 260000 + 250000 + Math.round((-30000 * 16) / 31), recurring: 250000 });
    expect(p.months[1].cents - p.months[0].cents).toBe(250000 - 30000);
    expect(p.recurring).toBe(250000);
    expect(p.history.map((h) => h.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(p.history[2].cents).toBe(100000);
    expect(p.history[5].cents).toBe(260000);
  });

  it("ignores paused rules and doesn't average months before the first transaction", () => {
    const p = project([{ date: "2026-09-10", amount_cents: -9000, currency: "EUR", category: null }], [{ ...salary, active: false }], "2026-10-01", 2);
    expect(p.variable).toBe(-9000);
    expect(p.recurring).toBe(0);
  });
});

describe("savings goals", () => {
  it("tracks what is put aside and what the deadline takes per month", () => {
    createGoal({ name: "Holiday", target: 120000, currency: "EUR", deadline: "2027-03-31" });
    const id = listGoals().find((g) => g.name === "Holiday")!.id;
    moveToGoal(id, 50000, "2026-10-01", "first");
    moveToGoal(id, -10000, "2026-10-02", null);
    const g = listGoals().find((x) => x.id === id)!;
    expect(g.saved).toBe(40000);
    expect(g.moves.map((m) => m.amount)).toEqual([-10000, 50000]);
    expect(monthlyNeeded({ target: 120000, saved: 40000, deadline: "2027-03-31" }, "2026-10-08")).toBe(13334); // 6 months left
    expect(monthlyNeeded({ target: 100, saved: 100, deadline: "2027-03-31" }, "2026-10-08")).toBeNull();
    expect(() => moveToGoal(99999, 100, "2026-10-01", null)).toThrow(/No such goal/);
  });
});

describe("xlsx import", () => {
  it("reads the first sheet with data: shared, rich and inline strings, dates, formulas, gaps", () => {
    const rows = readXlsx(fs.readFileSync(path.join(__dirname, "fixtures/statement.xlsx")));
    expect(rows).toEqual([
      ["Date", "Libellé", "", "Montant"],
      ["2026-10-02", "Café & croissant", "", "-4.2"],
      ["2026-10-03", "Virement reçu", "", "1500"],
      ["2026-10-04", "Salaire", "", "2500"],
    ]);
    const { transactions, errors } = mapRows(rows, { ...guessMapping(rows[0]), date: 0, description: 1, dateFormat: "auto", decimal: ".", header: true });
    expect(errors).toEqual([]);
    expect(transactions.map((t) => t.amountCents)).toEqual([-420, 150000, 250000]);
  });

  it("converts cell references and day numbers", () => {
    expect([colIndex("A1"), colIndex("Z9"), colIndex("AA10")]).toEqual([0, 25, 26]);
    expect(serialToDate(46297)).toBe("2026-10-02");
    expect(serialToDate(0, true)).toBe("1904-01-01");
  });

  it("refuses files that aren't xlsx", () => {
    expect(() => readXlsx(Buffer.from("date,amount\n2026-10-01,5"))).toThrow(/Not an .xlsx/);
  });
});

describe("category colours", () => {
  it("gives a category with its own colour its own slice, even without a palette slot", () => {
    const s = summarize(
      [
        { date: "2026-10-01", amount_cents: -5000, currency: "EUR", category: "Pets" },
        { date: "2026-10-02", amount_cents: -1000, currency: "EUR", category: "Misc" },
      ],
      [
        { name: "Pets", slot: null, color: "#aa3377" },
        { name: "Misc", slot: null },
      ],
      "2026-10",
      "EUR",
    );
    expect(s.categories).toEqual([
      { name: "Pets", cents: 5000, slot: null, color: "#aa3377" },
      { name: "Other", cents: 1000, slot: null },
    ]);
  });
});

describe("slack and telegram", () => {
  let server: http.Server;
  let base = "";
  const got: { url: string; body: string }[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        got.push({ url: req.url ?? "", body });
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("counts as channels and posts Slack's text payload", async () => {
    expect(hasAlertChannel({ threshold: 2, certDays: 14, slack: "https://hooks.slack.com/x" })).toBe(true);
    expect(hasAlertChannel({ threshold: 2, certDays: 14, telegramToken: "1:a" })).toBe(false); // needs a chat
    const errors = await sendNotice({ threshold: 2, certDays: 14, slack: `${base}/slack` }, { kind: "cert", level: "warn", message: "NAS cert expires soon.", url: "https://nas" });
    expect(errors).toEqual([]);
    expect(JSON.parse(got[0].body)).toEqual({ text: "NAS cert expires soon.\n<https://nas>" });
  });

  it("refuses a malformed Telegram token instead of building a URL with it", async () => {
    const errors = await sendNotice({ threshold: 2, certDays: 14, telegramToken: "x/../../evil", telegramChat: "1" }, { kind: "cert", level: "info", message: "hi" });
    expect(errors).toEqual(["Telegram: the bot token looks wrong (expected 123456:ABC…)"]);
  });
});

describe("chart ticks", () => {
  it("reaches below zero on the same steps and always includes 0", () => {
    expect(niceRange(0, 95)).toEqual([0, 25, 50, 75, 100]);
    const t = niceRange(-1200, 3400);
    expect(t).toContain(0);
    expect(t[0]).toBeLessThanOrEqual(-1200);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(3400);
  });
});
