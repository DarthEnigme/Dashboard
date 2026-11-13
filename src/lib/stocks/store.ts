import { db, transaction } from "../db";
import { fail, isDate, num, oneOf, text } from "../clean";
import { all, one, owned, run } from "../sql";
import { localDay } from "../day";
import { SYMBOL, TRADE_KINDS, type Portfolio, type PortfolioInput, type Transaction, type TransactionInput } from "./types";

/** Portfolios, their buys and sells, and the symbols someone watches: all private to their owner. */

const MAX_PORTFOLIOS = 20;

/** A Yahoo symbol in capitals, or an error. */
export const cleanSymbol = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return SYMBOL.test(s) ? s : fail("That doesn't look like a symbol (AAPL, MC.PA, ^GSPC…)");
};

const cleanCurrency = (v: unknown): string => (typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : fail("The currency is three letters (EUR, USD…)"));

// ---------- portfolios ----------

export const listPortfolios = (userId: number) => all<Portfolio>("SELECT id, name, currency FROM stock_portfolios WHERE owner_id = ? ORDER BY created_at, id", userId);

/** This person's portfolios; someone with none gets a first one, named `name`, in `currency` (checked and made at once, so never twice). */
export const ensurePortfolios = (userId: number, name: string, currency: string): Portfolio[] =>
  transaction(() => {
    if (!listPortfolios(userId).length) addPortfolio(userId, { name, currency });
    return listPortfolios(userId);
  });

/** The id of one of this person's portfolios, or an error. */
export const ownPortfolio = (userId: number, id: number) => owned("stock_portfolios", userId, id, "No such portfolio");

export function addPortfolio(userId: number, b: PortfolioInput) {
  const name = text(b.name, 60) ?? fail("Name required");
  const currency = cleanCurrency(b.currency);
  transaction(() => {
    if (listPortfolios(userId).length >= MAX_PORTFOLIOS) fail(`A person can have up to ${MAX_PORTFOLIOS} portfolios`);
    run("INSERT INTO stock_portfolios (owner_id, name, currency, created_at) VALUES (?, ?, ?, ?)", userId, name, currency, Date.now());
  });
}

export function updatePortfolio(userId: number, b: PortfolioInput) {
  run("UPDATE stock_portfolios SET name = ?, currency = ? WHERE id = ?", text(b.name, 60) ?? fail("Name required"), cleanCurrency(b.currency), ownPortfolio(userId, Number(b.id)));
}

/** Deletes the portfolio with its transactions; the last one stays. */
export function deletePortfolio(userId: number, id: number) {
  const own = ownPortfolio(userId, id);
  transaction(() => {
    if (listPortfolios(userId).length <= 1) fail("Keep at least one portfolio");
    run("DELETE FROM stock_portfolios WHERE id = ?", own);
    run("DELETE FROM stock_targets WHERE owner_id = ? AND portfolio_id = ?", userId, own);
  });
}

/** The symbols this person still holds some of, across their portfolios (from the trades alone: no prices needed). */
export const heldSymbols = (userId: number) =>
  all<{ symbol: string }>(
    `SELECT t.symbol FROM stock_transactions t JOIN stock_portfolios p ON p.id = t.portfolio_id WHERE p.owner_id = ?
     GROUP BY t.symbol HAVING SUM(CASE t.kind WHEN 'sell' THEN -t.quantity ELSE t.quantity END) > 1e-9 ORDER BY t.symbol`,
    userId,
  ).map((r) => r.symbol);

// ---------- transactions ----------

/** Every buy and sell of one portfolio, or of all of this person's: latest first. */
export function listTransactions(userId: number, portfolio?: number): Transaction[] {
  return all<Transaction>(
    `SELECT t.id, t.portfolio_id, t.symbol, t.kind, t.date, t.quantity, t.price, t.fees, t.currency, t.note, t.external_id
     FROM stock_transactions t JOIN stock_portfolios p ON p.id = t.portfolio_id
     WHERE p.owner_id = ? AND (? IS NULL OR p.id = ?) ORDER BY t.date DESC, t.id DESC`,
    userId,
    portfolio ?? null,
    portfolio ?? null,
  );
}

function cleanTransaction(userId: number, b: TransactionInput) {
  const date = isDate(b.date) ? b.date : fail("The date must be YYYY-MM-DD");
  if (date > localDay()) fail("The date is in the future");
  return {
    portfolio: ownPortfolio(userId, Number(b.portfolio)),
    symbol: cleanSymbol(b.symbol),
    kind: oneOf(b.kind, TRADE_KINDS, "buy"),
    date,
    quantity: num(b.quantity, 1e-8, 1e12) ?? fail("The quantity must be more than zero"),
    price: num(b.price, 0, 1e12) ?? fail("The price can't be negative"),
    fees: b.fees === undefined || b.fees === "" || b.fees === null ? 0 : (num(b.fees, 0, 1e9) ?? fail("The fees can't be negative")),
    note: text(b.note, 200),
  };
}

/** { portfolio, symbol, kind, date, quantity, price, fees?, note? }; `currency` is what the symbol is quoted in. */
export function addTransaction(userId: number, b: TransactionInput, currency: string) {
  const t = cleanTransaction(userId, b);
  run(
    "INSERT INTO stock_transactions (portfolio_id, symbol, kind, date, quantity, price, fees, currency, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    t.portfolio,
    t.symbol,
    t.kind,
    t.date,
    t.quantity,
    t.price,
    t.fees,
    currency,
    t.note,
    Date.now(),
  );
}

/** A trade from a file or a broker: the usual fields, what the symbol is quoted in, and its id at the source. */
export type ImportedInput = TransactionInput & { currency: string; external_id: string };

/**
 * Trades from an import or a broker, into one portfolio, all or none: one already there (same id at
 * its source, or a NanoDash export's `tx:<id>` of a trade in this portfolio) is skipped.
 */
export function addImported(userId: number, portfolio: number, trades: ImportedInput[]): { added: number; skipped: number } {
  const own = ownPortfolio(userId, portfolio);
  const cleaned = trades.map((t) => ({ ...cleanTransaction(userId, { ...t, portfolio: own }), currency: t.currency, external_id: t.external_id }));
  return transaction(() => {
    let added = 0;
    const insert = db().prepare(
      "INSERT OR IGNORE INTO stock_transactions (portfolio_id, symbol, kind, date, quantity, price, fees, currency, note, external_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const exported = db().prepare("SELECT 1 FROM stock_transactions WHERE id = ? AND portfolio_id = ?");
    for (const t of cleaned) {
      const tx = /^tx:(\d+)$/.exec(t.external_id);
      if (tx && exported.get(Number(tx[1]), own)) continue;
      added += Number(insert.run(own, t.symbol, t.kind, t.date, t.quantity, t.price, t.fees, t.currency, t.note, t.external_id, Date.now()).changes);
    }
    return { added, skipped: trades.length - added };
  });
}

/** Which of these ids a portfolio already has (to mark duplicates before an import). */
export function knownIds(userId: number, portfolio: number, ids: string[]): Set<string> {
  const own = ownPortfolio(userId, portfolio);
  const rows = all<{ id: number; external_id: string | null }>("SELECT id, external_id FROM stock_transactions WHERE portfolio_id = ?", own);
  const have = new Set(rows.flatMap((r) => [`tx:${r.id}`, ...(r.external_id ? [r.external_id] : [])]));
  return new Set(ids.filter((id) => have.has(id)));
}

const ownTransaction = (userId: number, id: number) =>
  one<{ id: number }>("SELECT t.id FROM stock_transactions t JOIN stock_portfolios p ON p.id = t.portfolio_id WHERE t.id = ? AND p.owner_id = ?", id, userId)?.id ?? fail("No such transaction");

export function updateTransaction(userId: number, b: TransactionInput, currency: string) {
  const id = ownTransaction(userId, Number(b.id));
  const t = cleanTransaction(userId, b);
  run(
    "UPDATE stock_transactions SET portfolio_id = ?, symbol = ?, kind = ?, date = ?, quantity = ?, price = ?, fees = ?, currency = ?, note = ? WHERE id = ?",
    t.portfolio,
    t.symbol,
    t.kind,
    t.date,
    t.quantity,
    t.price,
    t.fees,
    currency,
    t.note,
    id,
  );
}

export function deleteTransaction(userId: number, id: number) {
  run("DELETE FROM stock_transactions WHERE id = ?", ownTransaction(userId, id));
}

// ---------- watchlist ----------

export const listWatched = (userId: number) => all<{ symbol: string }>("SELECT symbol FROM stock_watch WHERE owner_id = ? ORDER BY created_at, symbol", userId).map((r) => r.symbol);

export function watch(userId: number, symbol: string) {
  if (listWatched(userId).length >= 100) fail("A watchlist can hold up to 100 symbols");
  run("INSERT OR IGNORE INTO stock_watch (owner_id, symbol, created_at) VALUES (?, ?, ?)", userId, cleanSymbol(symbol), Date.now());
}

export function unwatch(userId: number, symbol: string) {
  run("DELETE FROM stock_watch WHERE owner_id = ? AND symbol = ?", userId, symbol.toUpperCase());
}
