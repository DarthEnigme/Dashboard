import { db, transaction } from "../db";
import { fail, isDate, num, oneOf, text } from "../clean";
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

export const listPortfolios = (userId: number) => db().prepare("SELECT id, name, currency FROM stock_portfolios WHERE owner_id = ? ORDER BY created_at, id").all(userId) as unknown as Portfolio[];

/** This person's portfolios; someone with none gets a first one, named `name`, in `currency`. */
export function ensurePortfolios(userId: number, name: string, currency: string): Portfolio[] {
  const list = listPortfolios(userId);
  if (list.length) return list;
  addPortfolio(userId, { name, currency });
  return listPortfolios(userId);
}

/** The id of one of this person's portfolios, or an error. */
export const ownPortfolio = (userId: number, id: number) =>
  (db().prepare("SELECT id FROM stock_portfolios WHERE id = ? AND owner_id = ?").get(id, userId) as { id: number } | undefined)?.id ?? fail("No such portfolio");

export function addPortfolio(userId: number, b: PortfolioInput) {
  if (listPortfolios(userId).length >= MAX_PORTFOLIOS) fail(`A person can have up to ${MAX_PORTFOLIOS} portfolios`);
  db()
    .prepare("INSERT INTO stock_portfolios (owner_id, name, currency, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, text(b.name, 60) ?? fail("Name required"), cleanCurrency(b.currency), Date.now());
}

export function updatePortfolio(userId: number, b: PortfolioInput) {
  db()
    .prepare("UPDATE stock_portfolios SET name = ?, currency = ? WHERE id = ?")
    .run(text(b.name, 60) ?? fail("Name required"), cleanCurrency(b.currency), ownPortfolio(userId, Number(b.id)));
}

/** Deletes the portfolio with its transactions; the last one stays. */
export function deletePortfolio(userId: number, id: number) {
  const own = ownPortfolio(userId, id);
  if (listPortfolios(userId).length <= 1) fail("Keep at least one portfolio");
  db().prepare("DELETE FROM stock_portfolios WHERE id = ?").run(own);
}

/** The symbols this person still holds some of, across their portfolios (from the trades alone: no prices needed). */
export const heldSymbols = (userId: number) =>
  (
    db()
      .prepare(
        `SELECT t.symbol FROM stock_transactions t JOIN stock_portfolios p ON p.id = t.portfolio_id WHERE p.owner_id = ?
         GROUP BY t.symbol HAVING SUM(CASE t.kind WHEN 'sell' THEN -t.quantity ELSE t.quantity END) > 1e-9 ORDER BY t.symbol`,
      )
      .all(userId) as { symbol: string }[]
  ).map((r) => r.symbol);

// ---------- transactions ----------

/** Every buy and sell of one portfolio, or of all of this person's: latest first. */
export function listTransactions(userId: number, portfolio?: number): Transaction[] {
  return db()
    .prepare(
      `SELECT t.id, t.portfolio_id, t.symbol, t.kind, t.date, t.quantity, t.price, t.fees, t.currency, t.note, t.external_id
       FROM stock_transactions t JOIN stock_portfolios p ON p.id = t.portfolio_id
       WHERE p.owner_id = ? AND (? IS NULL OR p.id = ?) ORDER BY t.date DESC, t.id DESC`,
    )
    .all(userId, portfolio ?? null, portfolio ?? null) as unknown as Transaction[];
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
  db()
    .prepare("INSERT INTO stock_transactions (portfolio_id, symbol, kind, date, quantity, price, fees, currency, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(t.portfolio, t.symbol, t.kind, t.date, t.quantity, t.price, t.fees, currency, t.note, Date.now());
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
  const rows = db().prepare("SELECT id, external_id FROM stock_transactions WHERE portfolio_id = ?").all(own) as { id: number; external_id: string | null }[];
  const have = new Set(rows.flatMap((r) => [`tx:${r.id}`, ...(r.external_id ? [r.external_id] : [])]));
  return new Set(ids.filter((id) => have.has(id)));
}

const ownTransaction = (userId: number, id: number) =>
  (db().prepare("SELECT t.id FROM stock_transactions t JOIN stock_portfolios p ON p.id = t.portfolio_id WHERE t.id = ? AND p.owner_id = ?").get(id, userId) as { id: number } | undefined)?.id ??
  fail("No such transaction");

export function updateTransaction(userId: number, b: TransactionInput, currency: string) {
  const id = ownTransaction(userId, Number(b.id));
  const t = cleanTransaction(userId, b);
  db()
    .prepare("UPDATE stock_transactions SET portfolio_id = ?, symbol = ?, kind = ?, date = ?, quantity = ?, price = ?, fees = ?, currency = ?, note = ? WHERE id = ?")
    .run(t.portfolio, t.symbol, t.kind, t.date, t.quantity, t.price, t.fees, currency, t.note, id);
}

export function deleteTransaction(userId: number, id: number) {
  db().prepare("DELETE FROM stock_transactions WHERE id = ?").run(ownTransaction(userId, id));
}

// ---------- watchlist ----------

export const listWatched = (userId: number) =>
  (db().prepare("SELECT symbol FROM stock_watch WHERE owner_id = ? ORDER BY created_at, symbol").all(userId) as { symbol: string }[]).map((r) => r.symbol);

export function watch(userId: number, symbol: string) {
  if (listWatched(userId).length >= 100) fail("A watchlist can hold up to 100 symbols");
  db().prepare("INSERT OR IGNORE INTO stock_watch (owner_id, symbol, created_at) VALUES (?, ?, ?)").run(userId, cleanSymbol(symbol), Date.now());
}

export function unwatch(userId: number, symbol: string) {
  db().prepare("DELETE FROM stock_watch WHERE owner_id = ? AND symbol = ?").run(userId, symbol.toUpperCase());
}
