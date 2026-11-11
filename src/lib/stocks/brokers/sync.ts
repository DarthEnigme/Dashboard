import { db } from "../../db";
import { text } from "../../clean";
import { errorReason } from "../../cache";
import { openSecret, sealSecret } from "../../auth/totp";
import { resolveTrades, saveTrades } from "../import";
import type { BrokerInput } from "../types";
import { ibkr } from "./ibkr";
import { trading212 } from "./trading212";
import type { Broker } from "./types";

/**
 * Connections to brokers: each one feeds a portfolio. A sync reads the broker's trades and adds
 * the new ones through the same path as an imported file; hourly, connections not synced for six
 * hours are synced again.
 */

export const BROKERS: Record<Broker["kind"], Broker> = { t212: trading212, ibkr };
const SIX_HOURS = 6 * 3_600_000;
const fail = (message: string): never => {
  throw new Error(message);
};

export interface Connection {
  id: number;
  kind: Broker["kind"];
  label: string;
  portfolio_id: number;
  account: string | null;
  synced_at: number | null;
  error: string | null;
  /** A sync is under way. */
  syncing: boolean;
  /** Trades added by the last sync. */
  added: number | null;
}

type Row = Omit<Connection, "label" | "syncing" | "added"> & { owner_id: number; secret: string };
const running = new Set<number>();
const lastAdded = new Map<number, number>();

const rows = (where: string, ...args: (number | string)[]) => db().prepare(`SELECT id, owner_id, kind, portfolio_id, secret, account, synced_at, error FROM stock_brokers WHERE ${where} ORDER BY id`).all(...args) as unknown as Row[];

/** This person's connections, without their keys. */
export const listConnections = (userId: number): Connection[] =>
  rows("owner_id = ?", userId).map((r) => ({
    id: r.id,
    kind: r.kind,
    label: BROKERS[r.kind]?.label ?? r.kind,
    portfolio_id: r.portfolio_id,
    account: r.account,
    synced_at: r.synced_at,
    error: r.error,
    syncing: running.has(r.id),
    added: lastAdded.get(r.id) ?? null,
  }));

/** { kind: t212 | ibkr, portfolio, secret, account? } */
export function addConnection(userId: number, b: BrokerInput) {
  const kind = Object.hasOwn(BROKERS, String(b.kind)) ? (b.kind as Broker["kind"]) : fail("Pick a broker");
  const portfolio = (db().prepare("SELECT id FROM stock_portfolios WHERE id = ? AND owner_id = ?").get(Number(b.portfolio), userId) as { id: number } | undefined)?.id ?? fail("No such portfolio");
  const secret = text(b.secret, 500) ?? fail(kind === "ibkr" ? "The Flex token is required" : "The API key is required");
  const account = text(b.account, 40);
  if (kind === "ibkr" && !account) fail("The Flex query id is required");
  if (rows("owner_id = ?", userId).length >= 10) fail("A person can connect up to 10 brokers");
  return Number(db().prepare("INSERT INTO stock_brokers (owner_id, portfolio_id, kind, secret, account, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(userId, portfolio, kind, sealSecret(secret), account, Date.now()).lastInsertRowid);
}

export function deleteConnection(userId: number, id: number) {
  if (!db().prepare("DELETE FROM stock_brokers WHERE id = ? AND owner_id = ?").run(id, userId).changes) fail("No such connection");
}

/** Read the broker's trades and add the new ones; the outcome is kept on the connection. */
async function sync(row: Row): Promise<void> {
  if (running.has(row.id)) return;
  running.add(row.id);
  try {
    const secret = openSecret(row.secret) ?? fail("The key can't be read any more (the instance's secret key changed): connect again");
    const broker = BROKERS[row.kind] ?? fail(`Unknown broker ${row.kind}`);
    const resolved = await resolveTrades(await broker.trades(secret, row.account));
    const { added } = saveTrades(row.owner_id, row.portfolio_id, resolved, broker.label);
    lastAdded.set(row.id, added);
    db().prepare("UPDATE stock_brokers SET synced_at = ?, error = ? WHERE id = ?").run(Date.now(), null, row.id);
  } catch (e) {
    db().prepare("UPDATE stock_brokers SET synced_at = ?, error = ? WHERE id = ?").run(Date.now(), errorReason(e), row.id);
  } finally {
    running.delete(row.id);
  }
}

/** Start a sync of one of this person's connections (it runs on; the list shows when it is done). */
export function startSync(userId: number, id: number): Promise<void> {
  const [row] = rows("id = ? AND owner_id = ?", id, userId);
  if (!row) fail("No such connection");
  return sync(row);
}

/** Hourly: sync the connections that haven't been for six hours. */
export async function brokerSyncJob(now = Date.now()) {
  for (const row of rows("synced_at IS NULL OR synced_at < ?", now - SIX_HOURS)) await sync(row);
}
