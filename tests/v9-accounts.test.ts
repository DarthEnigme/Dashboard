import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { summarize } from "@/lib/finance/aggregate";
import { addTransaction, allForSummary, deleteTransaction, listTransactions } from "@/lib/finance/store";
import { createAccount, deleteAccount, listAccounts, seedAccounts, transfer, updateAccount, withBalances } from "@/lib/finance/accounts";

const noRates = () => undefined;
const balances = (today = "2026-10-31") => Object.fromEntries(withBalances(listAccounts(), noRates, today).map((a) => [a.name, a.balance]));

beforeEach(() => {
  db().exec("DELETE FROM fin_transactions; DELETE FROM fin_accounts; DELETE FROM fin_categories;");
});

describe("finance accounts", () => {
  it("creates accounts for names already on transactions (Firefly, CSV)", () => {
    addTransaction({ date: "2026-10-01", amountCents: -500, currency: "usd", description: "Coffee", account: "Visa" });
    addTransaction({ date: "2026-10-02", amountCents: -700, currency: "USD", description: "Lunch", account: "visa" });
    addTransaction({ date: "2026-10-02", amountCents: 1000, currency: "EUR", description: "Gift", account: "Wallet" });
    seedAccounts("EUR");
    seedAccounts("EUR"); // idempotent
    expect(listAccounts().map((a) => [a.name, a.currency])).toEqual([
      ["Visa", "USD"],
      ["Wallet", "EUR"],
    ]);
  });

  it("balances = opening + transactions, with month-end history", () => {
    createAccount({ name: "Checking", currency: "EUR", openingCents: 100000 });
    addTransaction({ date: "2026-09-15", amountCents: -20000, currency: "EUR", description: "Rent", account: "Checking" });
    addTransaction({ date: "2026-10-01", amountCents: 250000, currency: "EUR", description: "Salary", account: "checking" });
    addTransaction({ date: "2026-11-01", amountCents: -999, currency: "EUR", description: "Future", account: "Checking" });
    const [a] = withBalances(listAccounts(), noRates, "2026-10-20");
    expect(a.balance).toBe(100000 - 20000 + 250000);
    expect(a.transactions).toBe(3);
    expect(a.history.at(-2)).toEqual({ month: "2026-09", cents: 80000 });
    expect(a.history.at(-1)).toEqual({ month: "2026-10", cents: 330000 });
  });

  it("transfers move balances but are neither income nor spending", () => {
    createAccount({ name: "Checking", currency: "EUR", openingCents: 0 });
    createAccount({ name: "Savings", kind: "savings", currency: "EUR" });
    addTransaction({ date: "2026-10-01", amountCents: 300000, currency: "EUR", description: "Salary", account: "Checking", category: "Salary" });
    addTransaction({ date: "2026-10-03", amountCents: -5000, currency: "EUR", description: "Food", account: "Checking", category: "Food" });
    const [checking, savings] = listAccounts();
    transfer({ from: checking.id, to: savings.id, date: "2026-10-05", cents: 100000 });
    expect(balances()).toEqual({ Checking: 195000, Savings: 100000 });

    const s = summarize(allForSummary(), [], "2026-10", "EUR");
    expect(s.income).toBe(300000);
    expect(s.expense).toBe(5000);
    expect(s.count).toBe(2);
    expect(s.flow.sinks.map((x) => x.name)).toEqual(["Other"]);
    // The overall balance is unchanged by the transfer; one account's balance is not.
    expect(s.balance.at(-1)!.cents).toBe(295000);
    const onlySavings = summarize(allForSummary("Savings"), [], "2026-10", "EUR");
    expect(onlySavings.income).toBe(0);
    expect(onlySavings.balance.at(-1)!.cents).toBe(100000);

    // Deleting either half removes the whole transfer.
    const half = listTransactions({ account: "Savings" })[0];
    expect(half.source).toBe("transfer");
    deleteTransaction(half.id);
    expect(listTransactions().filter((t) => t.transfer_id)).toHaveLength(0);
  });

  it("asks for the received amount between currencies", () => {
    const eur = createAccount({ name: "Checking", currency: "EUR" });
    const usd = createAccount({ name: "Travel card", currency: "USD" });
    expect(() => transfer({ from: eur.id, to: usd.id, date: "2026-10-05", cents: 10000 })).toThrow(/received in USD/);
    transfer({ from: eur.id, to: usd.id, date: "2026-10-05", cents: 10000, toCents: 10800 });
    expect(balances()).toEqual({ Checking: -10000, "Travel card": 10800 });
    expect(() => transfer({ from: eur.id, to: eur.id, date: "2026-10-05", cents: 1 })).toThrow(/different/);
  });

  it("renaming an account renames it on its transactions; only empty accounts can be deleted", () => {
    const a = createAccount({ name: "Bank", currency: "EUR" });
    addTransaction({ date: "2026-10-01", amountCents: -100, currency: "EUR", description: "x", account: "bank" });
    updateAccount(a.id, { name: "Main bank" });
    expect(listTransactions()[0].account).toBe("Main bank");
    expect(() => createAccount({ name: "main BANK", currency: "EUR" })).toThrow(/already/);
    expect(() => deleteAccount(a.id)).toThrow(/archive it instead/);
    updateAccount(a.id, { archived: true });
    expect(listAccounts()[0].archived).toBe(true);
    const empty = createAccount({ name: "Empty", currency: "EUR" });
    deleteAccount(empty.id);
    expect(listAccounts().map((x) => x.name)).toEqual(["Main bank"]);
  });

  it("filters transactions by account", () => {
    addTransaction({ date: "2026-10-01", amountCents: -100, currency: "EUR", description: "a", account: "Cash" });
    addTransaction({ date: "2026-10-01", amountCents: -200, currency: "EUR", description: "b" });
    expect(listTransactions({ account: "cash" }).map((t) => t.description)).toEqual(["a"]);
    expect(listTransactions({ account: "" }).map((t) => t.description)).toEqual(["b"]);
    expect(allForSummary("Cash")).toHaveLength(1);
  });
});
