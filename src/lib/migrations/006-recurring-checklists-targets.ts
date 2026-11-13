import type { DatabaseSync } from "node:sqlite";

/** Schema step 6: Tasks that repeat, checklists and links to services; Stocks target weights. */
export function recurringChecklistsTargets(d: DatabaseSync) {
  d.exec(`
    -- Repeats every repeat_every days, weeks or months (NULL: once). Finishing it makes the next one.
    ALTER TABLE tasks ADD COLUMN repeat_every INTEGER;
    -- day | week | month
    ALTER TABLE tasks ADD COLUMN repeat_unit TEXT;
    -- JSON list of { text, done }.
    ALTER TABLE tasks ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]';
    -- The service (by its config id) the task is about: it shows on that service's page.
    ALTER TABLE tasks ADD COLUMN service_id TEXT;
    CREATE INDEX tasks_service ON tasks (service_id) WHERE service_id IS NOT NULL;

    -- What share of a portfolio (portfolio_id 0: all of them together) each symbol should be.
    CREATE TABLE stock_targets (
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      portfolio_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      -- Percent of the portfolio's value, 0 to 100.
      weight REAL NOT NULL,
      PRIMARY KEY (owner_id, portfolio_id, symbol)
    );
  `);
}
