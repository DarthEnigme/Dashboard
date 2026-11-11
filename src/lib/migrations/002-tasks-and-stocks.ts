import type { DatabaseSync } from "node:sqlite";

/** Schema step 2: task boards (private to their owner) and stock portfolios, with the cache of what Yahoo answered. */
export function tasksAndStocks(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE task_boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX task_boards_owner ON task_boards (owner_id);
    CREATE TABLE task_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES task_boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      ord INTEGER NOT NULL,
      -- Tasks moved here count as finished.
      done INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX task_columns_board ON task_columns (board_id, ord);
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id INTEGER NOT NULL REFERENCES task_columns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      -- 0 none, 1 low, 2 medium, 3 high
      priority INTEGER NOT NULL DEFAULT 0,
      due TEXT,
      labels TEXT NOT NULL DEFAULT '[]',
      ord INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX tasks_column ON tasks (column_id, ord);

    CREATE TABLE stock_portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX stock_portfolios_owner ON stock_portfolios (owner_id);
    -- Buys and sells; price and fees are in the currency the symbol is quoted in.
    CREATE TABLE stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL REFERENCES stock_portfolios(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      date TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      fees REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX stock_transactions_portfolio ON stock_transactions (portfolio_id, date);
    CREATE TABLE stock_watch (
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, symbol)
    );
    -- The last answer to each Yahoo request (JSON), served again when Yahoo doesn't answer.
    CREATE TABLE stock_cache (key TEXT PRIMARY KEY, at INTEGER NOT NULL, value TEXT NOT NULL);
  `);
}
