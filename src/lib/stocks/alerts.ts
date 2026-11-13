import { msg } from "@/i18n";
import type { Company } from "./yahoo";

/**
 * Stock alert rules and when they fire. Pure: the job gathers prices, positions and calendars into
 * an `AlertContext`, and `decide` says what to send and what to remember, so every rule can be
 * checked by hand.
 *
 * A rule fires when its condition starts to hold, then stays quiet while it keeps holding: a price
 * above 150 tells you once, and again only after it has gone back under. Rules about a day (a move,
 * a coming event) fire once for that day or that date.
 */

/** What a threshold is counted in: the symbol's or portfolio's currency, percent, or days. */
export type AlertUnit = "amount" | "%" | "days";
interface KindSpec {
  label: string;
  /** What the job fetches to read it: a quote, a portfolio summary, or the company's calendar. */
  needs: "quote" | "portfolio" | "company";
  /** It is about one symbol (else about a portfolio). */
  symbol: boolean;
  /** The lowest threshold allowed. */
  min: number;
  /** Its conditions, in the order offered: what their threshold counts, and when a reading meets it. */
  ops: Record<string, { label: string; unit: AlertUnit; holds: (reading: number, threshold: number) => boolean }>;
}

/** How a reading compares with the threshold. */
const atLeast = (x: number, v: number) => x >= v;
const atMost = (x: number, v: number) => x <= v;
const downBy = (x: number, v: number) => x <= -v;
const eitherBy = (x: number, v: number) => Math.abs(x) >= v;
/** Event rules hold when the date is within `v` days; the reading is the number of days to it. */
const withinDays = (days: number, v: number) => days >= 0 && days <= v;

/** Every kind of rule, its conditions and what they need: the one description the store, the job and the page share. */
export const ALERT_RULES = {
  /** The price crosses `value` (in the symbol's quote currency). */
  price: {
    label: msg("Price"),
    needs: "quote",
    symbol: true,
    min: 0,
    ops: { above: { label: msg("goes above"), unit: "amount", holds: atLeast }, below: { label: msg("goes below"), unit: "amount", holds: atMost } },
  },
  /** Today's change reaches ± `value` percent. */
  move: {
    label: msg("Daily move"),
    needs: "quote",
    symbol: true,
    min: 0.01,
    ops: { up: { label: msg("rises by"), unit: "%", holds: atLeast }, down: { label: msg("falls by"), unit: "%", holds: downBy }, either: { label: msg("moves by"), unit: "%", holds: eitherBy } },
  },
  /** What is held of the symbol is up `value` percent (a target), or down `value` percent (a stop). */
  position: {
    label: msg("Position"),
    needs: "portfolio",
    symbol: true,
    min: 0.01,
    ops: { gain: { label: msg("gains (target)"), unit: "%", holds: atLeast }, loss: { label: msg("loses (stop)"), unit: "%", holds: downBy } },
  },
  /** A portfolio's value crosses `value` (its currency), or its day reaches ± `value` percent. */
  portfolio: {
    label: msg("Portfolio"),
    needs: "portfolio",
    symbol: false,
    min: 0,
    ops: {
      above: { label: msg("goes above"), unit: "amount", holds: atLeast },
      below: { label: msg("goes below"), unit: "amount", holds: atMost },
      dayUp: { label: msg("rises in a day by"), unit: "%", holds: atLeast },
      dayDown: { label: msg("falls in a day by"), unit: "%", holds: downBy },
    },
  },
  /** Results, or an ex-dividend day, within `value` days. */
  event: {
    label: msg("Event"),
    needs: "company",
    symbol: true,
    min: 0.01,
    ops: {
      earnings: { label: msg("publishes results within"), unit: "days", holds: withinDays },
      exDividend: { label: msg("goes ex-dividend within"), unit: "days", holds: withinDays },
    },
  },
} as const satisfies Record<string, KindSpec>;
export type AlertKind = keyof typeof ALERT_RULES;
export const ALERT_KINDS = Object.keys(ALERT_RULES) as AlertKind[];

const opsOf = (kind: AlertKind): KindSpec["ops"] => ALERT_RULES[kind].ops;
/** A kind's conditions, in the order offered. */
export const alertOps = (kind: AlertKind) => Object.keys(opsOf(kind));
/** One condition of a kind; undefined when the kind has no such condition. */
export const alertOp = (kind: AlertKind, op: string) => (Object.hasOwn(opsOf(kind), op) ? opsOf(kind)[op] : undefined);

export interface AlertRule {
  id: number;
  kind: AlertKind;
  symbol: string | null;
  /** Position and portfolio rules: one portfolio, or null for all of the person's. */
  portfolio_id: number | null;
  op: string;
  value: number;
  /** Alert channels to use; empty for all of them. */
  channels: string[];
  note: string | null;
  active: boolean;
  /** What fired last and still holds. */
  fired_key: string | null;
  fired_at: number | null;
}

export interface AlertContext {
  today: string;
  quote: (symbol: string) => { price: number; change: number | null; currency: string; name: string } | undefined;
  /** The gain on what is held of `symbol` in a portfolio (or all of them), in percent. */
  position: (symbol: string, portfolio: number | null) => { gainPct: number | null } | undefined;
  portfolio: (portfolio: number | null) => { name: string; value: number; dayChangePct: number | null; currency: string } | undefined;
  company: (symbol: string) => Company | null | undefined;
}

/** A rule's reading now: whether it holds, under which key, and what to say. Undefined while the data it needs is missing. */
export interface Reading {
  holds: boolean;
  key: string;
  message: string;
  level: "info" | "warn";
  /** Keyed by a day: not holding any more doesn't re-arm it (the next day or date has its own key). */
  dated?: boolean;
}

const fmt = (n: number, digits = 2) => n.toLocaleString("en-US", { maximumFractionDigits: digits });
const pct = (n: number) => `${n > 0 ? "+" : ""}${fmt(n)} %`;
const DAY = 86_400_000;
const daysUntil = (today: string, day: string) => (Date.parse(day) - Date.parse(today)) / DAY;

/** A rule's reading now; undefined while the data it needs is missing (or the rule names a condition its kind doesn't have). */
export function read(rule: AlertRule, ctx: AlertContext): Reading | undefined {
  const condition = alertOp(rule.kind, rule.op);
  if (!condition) return undefined;
  const meets = (x: number) => condition.holds(x, rule.value);
  const tag = `${rule.kind}:${rule.op}:${rule.value}`;
  const symbol = rule.symbol ?? "";
  switch (rule.kind) {
    case "price": {
      const q = ctx.quote(symbol);
      if (!q) return undefined;
      const holds = meets(q.price);
      return { holds, key: tag, level: "info", message: `${symbol} (${q.name}) is ${rule.op} ${fmt(rule.value)} ${q.currency}: ${fmt(q.price)} ${q.currency} now.` };
    }
    case "move": {
      const q = ctx.quote(symbol);
      if (!q || q.change === null) return undefined;
      const holds = meets(q.change);
      return { holds, key: `${tag}:${ctx.today}`, dated: true, level: q.change < 0 ? "warn" : "info", message: `${symbol} (${q.name}) moved ${pct(q.change)} today, to ${fmt(q.price)} ${q.currency}.` };
    }
    case "position": {
      const p = ctx.position(symbol, rule.portfolio_id);
      if (!p || p.gainPct === null) return undefined;
      const holds = meets(p.gainPct);
      return { holds, key: tag, level: rule.op === "loss" ? "warn" : "info", message: `Your ${symbol} position is ${pct(p.gainPct)} (${rule.op === "gain" ? "target" : "stop"}: ${rule.op === "gain" ? "+" : "−"}${fmt(rule.value)} %).` };
    }
    case "portfolio": {
      const p = ctx.portfolio(rule.portfolio_id);
      if (!p) return undefined;
      if (rule.op === "above" || rule.op === "below") {
        const holds = meets(p.value);
        return { holds, key: tag, level: rule.op === "below" ? "warn" : "info", message: `${p.name} is ${rule.op} ${fmt(rule.value, 0)} ${p.currency}: ${fmt(p.value, 0)} ${p.currency} now.` };
      }
      if (p.dayChangePct === null) return undefined;
      const holds = meets(p.dayChangePct);
      return { holds, key: `${tag}:${ctx.today}`, dated: true, level: p.dayChangePct < 0 ? "warn" : "info", message: `${p.name} moved ${pct(p.dayChangePct)} today.` };
    }
    case "event": {
      const c = ctx.company(symbol);
      if (c === undefined) return undefined;
      const day = rule.op === "earnings" ? c?.calendar.earnings[0] : c?.calendar.exDividend;
      const holds = !!day && meets(daysUntil(ctx.today, day));
      const what = rule.op === "earnings" ? "publishes its results" : "goes ex-dividend";
      return { holds, key: `${tag}:${day ?? "none"}`, dated: true, level: "info", message: `${symbol} ${what} on ${day}.` };
    }
  }
}

/** What to do with a reading: the reading to send (only when it fires), and the key to remember. */
export function decide(rule: AlertRule, reading: Reading | undefined): { send?: Reading; key: string | null } {
  if (!reading) return { key: rule.fired_key };
  if (reading.holds) return reading.key !== rule.fired_key ? { send: reading, key: reading.key } : { key: reading.key };
  return { key: reading.dated ? rule.fired_key : null };
}
