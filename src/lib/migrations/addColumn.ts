import type { DatabaseSync } from "node:sqlite";

/** Columns added after a table was first released (SQLite has no ADD COLUMN IF NOT EXISTS). */
export function addColumn(d: DatabaseSync, table: string, column: string) {
  const name = column.split(" ")[0];
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === name)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
}
