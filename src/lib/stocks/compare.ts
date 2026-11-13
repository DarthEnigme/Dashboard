import { daysBefore, localDay } from "../day";
import { thin } from "./portfolio";
import { companyOf, factsFor, history, portfolioSnapshot } from "./service";
import { betaAndCorrelation, volatility, type Closes } from "./stats";
import { listPortfolios } from "./store";
import { BENCHMARKS, rangeStart, type CompareData, type Range } from "./types";

/**
 * Everything the compare page needs at once: each symbol's figures and prices over the range
 * (with its beta and correlation against the benchmark), and, when asked, the person's portfolio
 * crossed with the market (exposure by country, currency and sector; its beta).
 */

const closesOf = (h: { days: string[]; closes: number[] }): Closes => ({ days: h.days, closes: h.closes });

/** Sum of `value` by `key`, largest first. */
const sumBy = <T>(xs: T[], key: (x: T) => string, value: (x: T) => number) =>
  [...xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + value(x)), new Map<string, number>())].map(([name, v]) => ({ name, value: v })).sort((a, b) => b.value - a.value);

const NO_CLOSES: Closes = { days: [], closes: [] };

export async function loadCompare(userId: number, symbols: string[], range: Range, benchmarkSymbol: string | undefined, withPortfolio: boolean): Promise<CompareData> {
  const today = localDay();
  const from = rangeStart(range, today);
  const benchmark = BENCHMARKS.find((b) => b.symbol === benchmarkSymbol) ?? BENCHMARKS[0];
  const portfolios = withPortfolio ? listPortfolios(userId) : [];
  // The symbols, the benchmark and the portfolio don't wait for one another.
  const benchCloses = history(benchmark.symbol, from).then(closesOf, () => NO_CLOSES);
  const [rows, portfolio, benchChart] = await Promise.all([
    Promise.all(
      symbols.map(async (symbol) => {
        const [facts, h, bench] = await Promise.all([factsFor(symbol), history(symbol, from).catch(() => undefined), benchCloses]);
        const closes = h ? closesOf(h) : NO_CLOSES;
        return {
          ...facts,
          change: h?.change ?? null,
          chart: thin(closes, 400),
          ...betaAndCorrelation(closes, bench),
          volatility: volatility(closes),
          country: facts.company?.profile?.country ?? null,
        };
      }),
    ),
    portfolios.length ? portfolioCompare(userId, portfolios, benchmark.symbol, today) : null,
    benchCloses,
  ]);
  return { range, benchmark: { symbol: benchmark.symbol, name: benchmark.name, chart: thin(benchChart, 400) }, symbols: rows, portfolio };
}

/** The person's portfolio crossed with the market: exposure by country, currency and sector, and its beta over a year. */
async function portfolioCompare(userId: number, portfolios: ReturnType<typeof listPortfolios>, benchmark: string, today: string): Promise<CompareData["portfolio"]> {
  const yearAgo = daysBefore(today, 366);
  const [data, yearBench] = await Promise.all([portfolioSnapshot(userId, portfolios), history(benchmark, yearAgo).catch(() => undefined)]);
  const holdings = await Promise.all(
    data.positions.map(async (p) => {
      const [company, h] = await Promise.all([companyOf(p.symbol), history(p.symbol, yearAgo).catch(() => undefined)]);
      const { beta } = h && yearBench ? betaAndCorrelation(closesOf(h), closesOf(yearBench)) : { beta: null };
      return { symbol: p.symbol, name: p.name, value: p.value, weight: p.weight, sector: p.sector, currency: p.currency.toUpperCase(), country: company?.profile?.country ?? null, beta };
    }),
  );
  const known = holdings.filter((h) => h.beta !== null);
  const knownWeight = known.reduce((s, h) => s + h.weight, 0);
  return {
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
