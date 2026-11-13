import type { DatabaseSync } from "node:sqlite";

/** Schema step 5: a broker sync's progress kept with the connection, so a restart or a second process sees it too. */
export function brokerSyncState(d: DatabaseSync) {
  d.exec(`
    -- Set while a sync runs (cleared when it ends); one that started long ago crashed and can be taken over.
    ALTER TABLE stock_brokers ADD COLUMN sync_started_at INTEGER;
    -- Trades the last successful sync added.
    ALTER TABLE stock_brokers ADD COLUMN last_added INTEGER;
  `);
}
