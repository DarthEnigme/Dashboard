import { db } from "./db";
import { fail } from "./clean";

/** Query helpers every store shares: one statement, its arguments, and the row shape it reads back. */
export type Arg = string | number | null;

export const run = (sql: string, ...args: Arg[]) => db().prepare(sql).run(...args);
export const one = <T>(sql: string, ...args: Arg[]) => db().prepare(sql).get(...args) as T | undefined;
export const all = <T>(sql: string, ...args: Arg[]) => db().prepare(sql).all(...args) as unknown as T[];

/** The id of a row of `table` that belongs to `userId` (its `owner_id`), or an error naming what is missing. */
export const owned = (table: string, userId: number, id: number, missing: string): number =>
  one<{ id: number }>(`SELECT id FROM ${table} WHERE id = ? AND owner_id = ?`, id, userId)?.id ?? fail(missing);

/** A checkbox sent by a client, as stored (1/0); undefined when it isn't a boolean, so it is left alone. */
export const bool = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : undefined);
/** A stored 1/0, read back. */
export const flag = (n: number) => n === 1;

/** Set the given columns of one row; an undefined value leaves that column as it is. */
export function patch(table: string, id: number, set: Record<string, Arg | undefined>) {
  const keys = Object.keys(set).filter((k) => set[k] !== undefined);
  if (keys.length) run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => set[k] as Arg), id);
}
