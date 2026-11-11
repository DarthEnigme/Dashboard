import { localDay } from "../day";
import { thin } from "./portfolio";
import { companyOf, factsFor, history, loadStocks } from "./service";
import { betaAndCorrelation, volatility, type Closes } from "./stats";
import { listPortfolios } from "./store";
import { BENCHMARKS, type CompareData, type Range } from "./types";

/**
 * Everything the compare page needs at once: each symbol's figures and prices over the range
 * (with its beta and correlation against the benchmark), and, when asked, the person's portfolio
 * crossed with the market (exposure by country, currency and sector; its beta).
 */

const DAY = 86_400_000;
const RANGE_DAYS: Record<Range, number> = { "1m": 31, "6m": 183, ytd: 0, "1y": 366, "5y": 5 * 366, max: 30 * 366 };

const startOf = (range: Range, today: string) => (range === "ytd" ? `${today.slice(0, 4)}-01-01` : new Date(Date.parse(today) - RANGE_DAYS[range] * DAY).toISOString().slice(0, 10));
const closesOf = (h: { days: string[]; closes: number[] }): Closes => ({ days: h.days, closes: h.closes });

/** Sum of `value` by `key`, largest first. */
const sumBy = <T>(xs: T[], key: (x: T) => string, value: (x: T) => number) =>
  [...xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + value(x)), new Map<string, number>())].map(([name, v]) => ({ name, value: v })).sort((a, b) => b.value - a.value);

export async function loadCompare(userId: number, symbols: string[], range: Range, benchmarkSymbol: string | undefined, withPortfolio: boolean): Promise<CompareData> {
  const today = localDay();
  const from = startOf(range, today);
  const benchmark = BENCHMARKS.find((b) => b.symbol === benchmarkSymbol) ?? BENCHMARKS[0];
  const bench = await history(benchmark.symbol, from).catch(() => undefined);
  const benchCloses = bench ? closesOf(bench) : { days: [], closes: [] };

  const rows = await Promise.all(
    symbols.map(async (symbol) => {
      const [facts, h] = await Promise.all([factsFor(symbol), history(symbol, from).catch(() => undefined)]);
      const closes = h ? closesOf(h) : { days: [], closes: [] };
      return {
        ...facts,
        change: h?.change ?? null,
        chart: thin(closes, 400),
        ...betaAndCorrelation(closes, benchCloses),
        volatility: volatility(closes),
        country: facts.company?.profile?.country ?? null,
      };
    }),
  );

  let portfolio: CompareData["portfolio"] = null;
  const portfolios = withPortfolio ? listPortfolios(userId) : [];
  if (portfolios.length) {
    const data = await loadStocks(userId, portfolios, undefined, benchmark.symbol);
    const yearAgo = new Date(Date.parse(today) - 366 * DAY).toISOString().slice(0, 10);
    const yearBench = await history(benchmark.symbol, yearAgo).catch(() => undefined);
    const holdings = await Promise.all(
      data.positions.map(async (p) => {
        const [company, h] = await Promise.all([companyOf(p.symbol), history(p.symbol, yearAgo).catch(() => undefined)]);
        const { beta } = h && yearBench ? betaAndCorrelation(closesOf(h), closesOf(yearBench)) : { beta: null };
        return { symbol: p.symbol, name: p.name, value: p.value, weight: p.weight, sector: p.sector, currency: p.currency.toUpperCase(), country: company?.profile?.country ?? null, beta };
      }),
    );
    const known = holdings.filter((h) => h.beta !== null);
    const knownWeight = known.reduce((s, h) => s + h.weight, 0);
    portfolio = {
      currency: data.currency,
      value: data.value,
      cost: data.cost,
      gain: data.gain,
      gainPct: data.gainPct,
      dividends: data.dividends,
      realized: data.realized,
      holdings,
      exposure: {
        country: sumBy(holdings, (h) => h.country ?? "?", (h) => h.value),
        currency: sumBy(holdings, (h) => h.currency, (h) => h.value),
        sector: sumBy(holdings, (h) => h.sector ?? "?", (h) => h.value),
      },
      // Weighted by value, over the holdings whose beta is known.
      beta: knownWeight > 0 ? known.reduce((s, h) => s + h.beta! * h.weight, 0) / knownWeight : null,
    };
  }

  return { range, benchmark: { symbol: benchmark.symbol, name: benchmark.name, chart: thin(benchCloses, 400) }, symbols: rows, portfolio };
}
