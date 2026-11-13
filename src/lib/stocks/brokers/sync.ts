import { transaction } from "../../db";
import { fail, text } from "../../clean";
import { errorReason } from "../../cache";
import { all, run } from "../../sql";
import { openSecret, sealSecret } from "../../auth/totp";
import { resolveTrades, saveTrades } from "../import";
import { ownPortfolio } from "../store";
import type { BrokerInput } from "../types";
import { ibkr } from "./ibkr";
import { trading212 } from "./trading212";
import { BROKER_INFO, type Broker, type BrokerKind } from "./types";

/**
 * Connections to brokers: each one feeds a portfolio. A sync reads the broker's trades and adds
 * the new ones through the same path as an imported file; hourly, connections not synced for six
 * hours are synced again. A sync's progress is kept on the connection, so every process (and the
 * next start) sees the same thing.
 */

const BROKERS: Record<BrokerKind, Broker> = { t212: trading212, ibkr };
const SIX_HOURS = 6 * 3_600_000;
/** Longer than any sync takes (Trading 212's slow paging included): one started earlier crashed. */
const STALE_SYNC = 45 * 60_000;
const MAX_CONNECTIONS = 10;

export interface Connection {
  id: number;
  kind: BrokerKind;
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

interface Row {
  id: number;
  owner_id: number;
  kind: BrokerKind;
  portfolio_id: number;
  secret: string;
  account: string | null;
  synced_at: number | null;
  error: string | null;
  sync_started_at: number | null;
  last_added: number | null;
}

const rows = (where: string, ...args: number[]) =>
  all<Row>(`SELECT id, owner_id, kind, portfolio_id, secret, account, synced_at, error, sync_started_at, last_added FROM stock_brokers WHERE ${where} ORDER BY id`, ...args);

const running = (r: Pick<Row, "sync_started_at">, now = Date.now()) => r.sync_started_at !== null && now - r.sync_started_at < STALE_SYNC;

/** This person's connections, without their keys. */
export const listConnections = (userId: number): Connection[] =>
  rows("owner_id = ?", userId).map((r) => ({
    id: r.id,
    kind: r.kind,
    label: BROKER_INFO[r.kind]?.label ?? r.kind,
    portfolio_id: r.portfolio_id,
    account: r.account,
    synced_at: r.synced_at,
    error: r.error,
    syncing: running(r),
    added: r.last_added,
  }));

/** { kind: t212 | ibkr, portfolio, secret, account? } */
export function addConnection(userId: number, b: BrokerInput) {
  const kind = Object.hasOwn(BROKER_INFO, String(b.kind)) ? (b.kind as BrokerKind) : fail("Pick a broker");
  const info = BROKER_INFO[kind];
  const portfolio = ownPortfolio(userId, Number(b.portfolio));
  const secret = text(b.secret, 500) ?? fail(info.secretMissing);
  const account = info.account ? (text(b.account, 40) ?? fail(info.account.missing)) : null;
  return transaction(() => {
    if (rows("owner_id = ?", userId).length >= MAX_CONNECTIONS) fail(`A person can connect up to ${MAX_CONNECTIONS} brokers`);
    return Number(run("INSERT INTO stock_brokers (owner_id, portfolio_id, kind, secret, account, created_at) VALUES (?, ?, ?, ?, ?, ?)", userId, portfolio, kind, sealSecret(secret), account, Date.now()).lastInsertRowid);
  });
}

export function deleteConnection(userId: number, id: number) {
  if (!run("DELETE FROM stock_brokers WHERE id = ? AND owner_id = ?", id, userId).changes) fail("No such connection");
}

/** Mark the connection as syncing, unless a sync of it is already under way: true when this caller got it. */
const claim = (id: number, now: number) => run("UPDATE stock_brokers SET sync_started_at = ? WHERE id = ? AND (sync_started_at IS NULL OR sync_started_at < ?)", now, id, now - STALE_SYNC).changes === 1;

/** Read the broker's trades and add the new ones; the outcome is kept on the connection. */
async function sync(row: Row): Promise<void> {
  if (!claim(row.id, Date.now())) return;
  try {
    const secret = openSecret(row.secret) ?? fail("The key can't be read any more (the instance's secret key changed): connect again");
    const broker = BROKERS[row.kind] ?? fail(`Unknown broker ${row.kind}`);
    const resolved = await resolveTrades(await broker.trades(secret, row.account));
    const { added } = saveTrades(row.owner_id, row.portfolio_id, resolved, BROKER_INFO[broker.kind].label);
    run("UPDATE stock_brokers SET synced_at = ?, error = NULL, last_added = ?, sync_started_at = NULL WHERE id = ?", Date.now(), added, row.id);
  } catch (e) {
    run("UPDATE stock_brokers SET synced_at = ?, error = ?, sync_started_at = NULL WHERE id = ?", Date.now(), errorReason(e), row.id);
  }
}

/** Start a sync of one of this person's connections (it runs on; the list shows when it is done). */
export function startSync(userId: number, id: number): Promise<void> {
  const [row] = rows("id = ? AND owner_id = ?", id, userId);
  if (!row) fail("No such connection");
  return sync(row);
}

/** Hourly: sync the connections that haven't been for six hours, side by side (each broker's limits are per key). */
export async function brokerSyncJob(now = Date.now()) {
  await Promise.all(rows("synced_at IS NULL OR synced_at < ?", now - SIX_HOURS).map(sync));
}
