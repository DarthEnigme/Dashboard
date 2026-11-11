import { db } from "../db";
import { num, text } from "../clean";
import { ALERT_CHANNELS } from "../alerts";
import { ALERT_RULES, type AlertKind, type AlertRule } from "./alerts";
import { cleanSymbol } from "./store";
import type { AlertInput } from "./types";

/** Stock alert rules, private to their owner. */

const MAX_ALERTS = 100;
const fail = (message: string): never => {
  throw new Error(message);
};

type Row = Omit<AlertRule, "channels" | "active"> & { owner_id: number; channels: string; active: number };
const COLUMNS = "id, owner_id, kind, symbol, portfolio_id, op, value, channels, note, active, fired_key, fired_at";
const toRule = (r: Row): AlertRule & { owner_id: number } => ({ ...r, channels: JSON.parse(r.channels) as string[], active: r.active === 1 });

export const listAlerts = (userId: number) => (db().prepare(`SELECT ${COLUMNS} FROM stock_alerts WHERE owner_id = ? ORDER BY created_at, id`).all(userId) as unknown as Row[]).map(toRule);

/** Every rule that is on, everyone's: for the job. */
export const activeAlerts = () => (db().prepare(`SELECT ${COLUMNS} FROM stock_alerts WHERE active = 1 ORDER BY owner_id, id`).all() as unknown as Row[]).map(toRule);

const ownPortfolio = (userId: number, v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const id = (db().prepare("SELECT id FROM stock_portfolios WHERE id = ? AND owner_id = ?").get(Number(v), userId) as { id: number } | undefined)?.id;
  return id ?? fail("No such portfolio");
};

function clean(userId: number, b: AlertInput) {
  const kind = (Object.hasOwn(ALERT_RULES, String(b.kind)) ? b.kind : fail("Pick what to watch for")) as AlertKind;
  const ops: readonly string[] = ALERT_RULES[kind];
  const op = ops.includes(String(b.op)) ? String(b.op) : fail("Pick a condition");
  const needsSymbol = kind !== "portfolio";
  const channels = Array.isArray(b.channels) ? [...new Set(b.channels.map(String))] : [];
  if (channels.some((c) => !(ALERT_CHANNELS as string[]).includes(c))) fail("Unknown alert channel");
  return {
    kind,
    op,
    symbol: needsSymbol ? cleanSymbol(b.symbol) : null,
    portfolio: kind === "portfolio" || kind === "position" ? ownPortfolio(userId, b.portfolio) : null,
    value: num(b.value, kind === "price" || kind === "portfolio" ? 0 : 0.01, 1e12) ?? fail("The threshold must be a positive number"),
    channels: JSON.stringify(channels),
    note: text(b.note, 200),
    active: b.active === false ? 0 : 1,
  };
}

/** { kind, op, value, symbol?, portfolio?, channels?, note?, active? } */
export function addAlert(userId: number, b: AlertInput) {
  if (listAlerts(userId).length >= MAX_ALERTS) fail(`A person can have up to ${MAX_ALERTS} alerts`);
  const a = clean(userId, b);
  db()
    .prepare("INSERT INTO stock_alerts (owner_id, kind, symbol, portfolio_id, op, value, channels, note, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(userId, a.kind, a.symbol, a.portfolio, a.op, a.value, a.channels, a.note, a.active, Date.now());
}

const ownAlert = (userId: number, id: number) => (db().prepare("SELECT id FROM stock_alerts WHERE id = ? AND owner_id = ?").get(id, userId) as { id: number } | undefined)?.id ?? fail("No such alert");

/** { id, …the same }: a changed rule starts again, as if it had never fired. */
export function updateAlert(userId: number, b: AlertInput) {
  const id = ownAlert(userId, Number(b.id));
  const a = clean(userId, b);
  db()
    .prepare("UPDATE stock_alerts SET kind = ?, symbol = ?, portfolio_id = ?, op = ?, value = ?, channels = ?, note = ?, active = ?, fired_key = NULL, fired_at = NULL WHERE id = ?")
    .run(a.kind, a.symbol, a.portfolio, a.op, a.value, a.channels, a.note, a.active, id);
}

export function deleteAlert(userId: number, id: number) {
  db().prepare("DELETE FROM stock_alerts WHERE id = ?").run(ownAlert(userId, id));
}

/** Remember what the rule last fired on (null once its condition stopped holding). */
export function markFired(id: number, key: string | null, firedNow: boolean) {
  if (firedNow) db().prepare("UPDATE stock_alerts SET fired_key = ?, fired_at = ? WHERE id = ?").run(key, Date.now(), id);
  else db().prepare("UPDATE stock_alerts SET fired_key = ? WHERE id = ?").run(key, id);
}
