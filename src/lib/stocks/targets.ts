import { transaction } from "../db";
import { fail, num } from "../clean";
import { all, run } from "../sql";
import type { Target } from "./rebalance";
import { cleanSymbol, ownPortfolio } from "./store";

/**
 * Target weights, private to their owner: what share of a portfolio each symbol should be. Each
 * portfolio has its own, and so do all of them together (scope 0).
 */

const MAX_TARGETS = 50;

/** A portfolio of this person's, or 0 for all of them together. */
const targetScope = (userId: number, portfolio: unknown) => (portfolio === null || portfolio === undefined || portfolio === "" || portfolio === 0 ? 0 : ownPortfolio(userId, Number(portfolio)));

export const listTargets = (userId: number, portfolio: number | null): Target[] =>
  all<Target>("SELECT symbol, weight FROM stock_targets WHERE owner_id = ? AND portfolio_id = ? ORDER BY weight DESC, symbol", userId, targetScope(userId, portfolio));

/** { portfolio (null: all together), targets: [{ symbol, weight }] }: replaces the scope's targets, all at once. */
export function setTargets(userId: number, b: { portfolio?: unknown; targets?: unknown }) {
  const scope = targetScope(userId, b.portfolio);
  if (!Array.isArray(b.targets)) fail("Targets are a list");
  const targets = (b.targets as unknown[]).map((x) => {
    const t = (typeof x === "object" && x ? x : {}) as Record<string, unknown>;
    return { symbol: cleanSymbol(t.symbol), weight: num(t.weight, 0, 100) ?? fail("A target is 0 to 100 %") };
  });
  if (targets.length > MAX_TARGETS) fail(`Up to ${MAX_TARGETS} targets`);
  if (new Set(targets.map((t) => t.symbol)).size < targets.length) fail("Each symbol once");
  if (targets.reduce((s, t) => s + t.weight, 0) > 100 + 1e-6) fail("The targets add up to more than 100 %");
  transaction(() => {
    run("DELETE FROM stock_targets WHERE owner_id = ? AND portfolio_id = ?", userId, scope);
    for (const t of targets) run("INSERT INTO stock_targets (owner_id, portfolio_id, symbol, weight) VALUES (?, ?, ?, ?)", userId, scope, t.symbol, t.weight);
  });
}
