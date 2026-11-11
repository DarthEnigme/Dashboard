import { db } from "../db";
import { fail, num, text } from "../clean";
import { ALERT_CHANNELS } from "../alerts";
import { ALERT_RULES, alertOp, type AlertKind, type AlertRule } from "./alerts";
import { cleanSymbol, ownPortfolio } from "./store";
import type { AlertInput } from "./types";

/** Stock alert rules, private to their owner. */

const MAX_ALERTS = 100;

type Row = Omit<AlertRule, "channels" | "active"> & { owner_id: number; channels: string; active: number };
const COLUMNS = "id, owner_id, kind, symbol, portfolio_id, op, value, channels, note, active, fired_key, fired_at";
const toRule = (r: Row): AlertRule & { owner_id: number } => ({ ...r, channels: JSON.parse(r.channels) as string[], active: r.active === 1 });

export const listAlerts = (userId: number) => (db().prepare(`SELECT ${COLUMNS} FROM stock_alerts WHERE owner_id = ? ORDER BY created_at, id`).all(userId) as unknown as Row[]).map(toRule);

/** Every rule that is on, everyone's: for the job. */
export const activeAlerts = () => (db().prepare(`SELECT ${COLUMNS} FROM stock_alerts WHERE active = 1 ORDER BY owner_id, id`).all() as unknown as Row[]).map(toRule);

/** A portfolio of this person's, or null for all of them. */
const portfolioOrAll = (userId: number, v: unknown) => (v === null || v === undefined || v === "" ? null : ownPortfolio(userId, Number(v)));

function clean(userId: number, b: AlertInput) {
  const kind = (Object.hasOwn(ALERT_RULES, String(b.kind)) ? b.kind : fail("Pick what to watch for")) as AlertKind;
  const spec = ALERT_RULES[kind];
  const op = alertOp(kind, String(b.op)) ? String(b.op) : fail("Pick a condition");
  const channels = Array.isArray(b.channels) ? [...new Set(b.channels.map(String))] : [];
  if (channels.some((c) => !(ALERT_CHANNELS as string[]).includes(c))) fail("Unknown alert channel");
  return {
    kind,
    op,
    symbol: spec.symbol ? cleanSymbol(b.symbol) : null,
    portfolio: spec.needs === "portfolio" ? portfolioOrAll(userId, b.portfolio) : null,
    value: num(b.value, spec.min, 1e12) ?? fail("The threshold must be a positive number"),
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

/** The columns that say when a rule holds. Changing one starts the rule again, as if it had never fired. */
const SAME_CONDITION = "kind = ? AND symbol IS ? AND portfolio_id IS ? AND op = ? AND value = ?";
const conditionOf = (r: { kind: string; symbol: string | null; op: string; value: number }, portfolio: number | null) => [r.kind, r.symbol, portfolio, r.op, r.value] as const;

/** { id, …the same }: a changed condition starts again; pausing, resuming, or changing the channels or the note doesn't. */
export function updateAlert(userId: number, b: AlertInput) {
  const id = ownAlert(userId, Number(b.id));
  const a = clean(userId, b);
  const condition = conditionOf(a, a.portfolio);
  db()
    .prepare(
      `UPDATE stock_alerts SET fired_key = CASE WHEN ${SAME_CONDITION} THEN fired_key END, fired_at = CASE WHEN ${SAME_CONDITION} THEN fired_at END,
       kind = ?, symbol = ?, portfolio_id = ?, op = ?, value = ?, channels = ?, note = ?, active = ? WHERE id = ?`,
    )
    .run(...condition, ...condition, ...condition, a.channels, a.note, a.active, id);
}

export function deleteAlert(userId: number, id: number) {
  db().prepare("DELETE FROM stock_alerts WHERE id = ?").run(ownAlert(userId, id));
}

/**
 * Remember what the rule last fired on (null once its condition stopped holding), unless its
 * condition was changed meanwhile: a rule edited while the job ran starts again as edited.
 */
export function markFired(rule: AlertRule, key: string | null, firedNow: boolean) {
  db()
    .prepare(`UPDATE stock_alerts SET fired_key = ?, fired_at = CASE WHEN ? THEN ? ELSE fired_at END WHERE id = ? AND ${SAME_CONDITION}`)
    .run(key, firedNow ? 1 : 0, Date.now(), rule.id, ...conditionOf(rule, rule.portfolio_id));
}
