import type { DatabaseSync } from "node:sqlite";

/** Schema step 4: Stocks alerts, connections to brokers, logos, and the id each imported trade has at its source. */
export function stockAlertsAndBrokers(d: DatabaseSync) {
  d.exec(`
    -- The trade's id at the broker, or a fingerprint of its import line: the same trade isn't added twice.
    ALTER TABLE stock_transactions ADD COLUMN external_id TEXT;
    CREATE UNIQUE INDEX stock_transactions_external ON stock_transactions (portfolio_id, external_id) WHERE external_id IS NOT NULL;
    CREATE TABLE stock_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- price | move | position | portfolio | event
      kind TEXT NOT NULL,
      symbol TEXT,
      portfolio_id INTEGER REFERENCES stock_portfolios(id) ON DELETE CASCADE,
      -- above | below (or gain | loss, earnings | dividend for the kinds that need them)
      op TEXT NOT NULL,
      value REAL NOT NULL,
      -- JSON list of alert channels; empty for all of them
      channels TEXT NOT NULL DEFAULT '[]',
      note TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      -- What last fired: the same condition doesn't fire again until it has stopped holding.
      fired_key TEXT,
      fired_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX stock_alerts_owner ON stock_alerts (owner_id);
    CREATE TABLE stock_brokers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      portfolio_id INTEGER NOT NULL REFERENCES stock_portfolios(id) ON DELETE CASCADE,
      -- t212 | ibkr
      kind TEXT NOT NULL,
      -- The API key or token, sealed with the instance's secret key.
      secret TEXT NOT NULL,
      -- Interactive Brokers: the Flex query id.
      account TEXT,
      synced_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX stock_brokers_owner ON stock_brokers (owner_id);
    -- Company logos: fetched (owner_id 0, shared by everyone) or uploaded by someone for themselves.
    CREATE TABLE stock_logos (
      symbol TEXT NOT NULL,
      owner_id INTEGER NOT NULL DEFAULT 0,
      mime TEXT,
      data BLOB,
      source TEXT,
      at INTEGER NOT NULL,
      PRIMARY KEY (symbol, owner_id)
    );
  `);
}
