import { loadConfig } from "../config/load";
import { hasAlertChannel, onlyChannels, sendNotice } from "../alerts";
import { daysBefore, localDay } from "../day";
import { ALERT_RULES, decide, read, type AlertContext, type AlertRule } from "./alerts";
import { activeAlerts, markFired } from "./alertStore";
import { companyOf, history, portfolioSnapshot } from "./service";
import { listPortfolios } from "./store";
import type { Company, Snapshot } from "./types";

/**
 * Checks everyone's stock alerts: gathers what the rules need (quotes, positions, calendars) once,
 * reads each rule, sends what fires to its channels and remembers it.
 */

type Quote = ReturnType<AlertContext["quote"]>;
type AlertNeed = (typeof ALERT_RULES)[keyof typeof ALERT_RULES]["needs"];

/** What one person's rules need, fetched up front so `read` stays synchronous. */
async function contextFor(userId: number, rules: AlertRule[], today: string): Promise<AlertContext> {
  const needing = (need: AlertNeed) => rules.filter((r) => ALERT_RULES[r.kind].needs === need);
  const symbolsOf = (list: AlertRule[]) => [...new Set(list.flatMap((r) => (r.symbol ? [r.symbol] : [])))];
  const symbols = symbolsOf(needing("quote"));
  const events = symbolsOf(needing("company"));
  // Position and portfolio rules read a portfolio summary (null: all of them together).
  const views = [...new Set(needing("portfolio").map((r) => r.portfolio_id))];
  const from = daysBefore(today, 10);
  const portfolios = views.length ? listPortfolios(userId) : [];

  const [quotes, companies, summaries] = await Promise.all([
    Promise.all(symbols.map(async (s) => [s, await history(s, from).then((h): Quote => ({ price: h.price, change: h.change, currency: h.currency, name: h.name })).catch(() => undefined)] as const)),
    Promise.all(events.map(async (s) => [s, await companyOf(s)] as const)),
    Promise.all(views.map(async (p) => [p, portfolios.length ? await portfolioSnapshot(userId, portfolios, p ?? undefined).catch(() => undefined) : undefined] as const)),
  ]);
  const quote = new Map(quotes);
  const company = new Map<string, Company | null>(companies);
  const summary = new Map<number | null, Snapshot | undefined>(summaries);

  return {
    today,
    quote: (s) => quote.get(s),
    company: (s) => company.get(s),
    position: (s, p) => {
      const pos = summary.get(p)?.positions.find((x) => x.symbol === s);
      return pos && { gainPct: pos.gainPct };
    },
    portfolio: (p) => {
      const d = summary.get(p);
      if (!d) return undefined;
      const name = portfolios.find((x) => x.id === p)?.name ?? "Your portfolios";
      return { name, value: d.value, dayChangePct: d.dayChangePct, currency: d.currency };
    },
  };
}

export async function stockAlertJob(now = new Date()) {
  const { settings } = loadConfig();
  if (!hasAlertChannel(settings.alerts)) return;
  const today = localDay(now);
  const byOwner = new Map<number, (AlertRule & { owner_id: number })[]>();
  for (const r of activeAlerts()) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r]);

  for (const [owner, rules] of byOwner) {
    const ctx = await contextFor(owner, rules, today);
    await Promise.all(
      rules.map(async (rule) => {
        const { send, key } = decide(rule, read(rule, ctx));
        if (!send) {
          if (key !== rule.fired_key) markFired(rule, key, false);
          return;
        }
        const message = rule.note ? `${send.message}\n${rule.note}` : send.message;
        const url = rule.symbol ? `/stocks/${encodeURIComponent(rule.symbol)}` : "/stocks";
        const errors = await sendNotice(onlyChannels(settings.alerts, rule.channels), { kind: "stock", level: send.level, message, url, symbol: rule.symbol ?? "" });
        // Not sent: try again next time.
        if (!errors.length) markFired(rule, key, true);
      }),
    );
  }
}
