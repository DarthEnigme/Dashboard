import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { forget } from "@/lib/cache";
import { remembered } from "@/lib/stocks/cache";
import { adjustForSplits, dividendsByYear, makeFx, summarize, thin, valueAt, type Market, type Trade } from "@/lib/stocks/portfolio";
import { addPortfolio, addTransaction, deletePortfolio, deleteTransaction, ensurePortfolios, listTransactions, listWatched, unwatch, updateTransaction, watch } from "@/lib/stocks/store";
import { loadResearch, loadStocks, loadWatchlist } from "@/lib/stocks/service";
import * as yahoo from "@/lib/stocks/yahoo";
import { parseFundamentals, parseHistory, parseSearch, type History } from "@/lib/stocks/yahoo";

const user = (name: string) => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, 'user', ?)").run(name, Date.now()).lastInsertRowid);
const ts = (day: string) => Date.parse(`${day}T12:00:00Z`) / 1000;

describe("Yahoo answers", () => {
  it("reads daily closes, dividends and splits from a chart", () => {
    const h = parseHistory({
      chart: {
        result: [
          {
            meta: { symbol: "MC.PA", longName: "LVMH", shortName: "LVMH SE", currency: "EUR", regularMarketPrice: 401, fiftyTwoWeekHigh: 654.7, fiftyTwoWeekLow: 375.65, fullExchangeName: "Paris" },
            // A day with no close is dropped; the running day comes twice and the later price wins.
            timestamp: [ts("2026-11-04"), ts("2026-11-05"), ts("2026-11-06"), ts("2026-11-09"), ts("2026-11-09") + 60],
            events: {
              dividends: { b: { amount: 7.5, date: ts("2026-04-23") }, a: { amount: 5.5, date: ts("2025-12-04") } },
              splits: { s: { date: ts("2026-06-01"), numerator: 4, denominator: 1 } },
            },
            indicators: { quote: [{ close: [390, null, 400, 402, 401] }] },
          },
        ],
        error: null,
      },
    });
    expect(h).toMatchObject({ symbol: "MC.PA", name: "LVMH", currency: "EUR", exchange: "Paris", price: 401, high52: 654.7, low52: 375.65 });
    expect(h.days).toEqual(["2026-11-04", "2026-11-06", "2026-11-09"]);
    expect(h.closes).toEqual([390, 400, 401]);
    expect(h.change).toBeCloseTo(0.25);
    expect(h.dividends).toEqual([
      { day: "2025-12-04", amount: 5.5 },
      { day: "2026-04-23", amount: 7.5 },
    ]);
    expect(h.splits).toEqual([{ day: "2026-06-01", ratio: 4 }]);
    expect(() => parseHistory({ chart: { result: null, error: { description: "No data found, symbol may be delisted" } } })).toThrow(/delisted/);
  });

  it("reads search hits", () => {
    const hits = parseSearch({ quotes: [{ symbol: "MC.PA", shortname: "Lvmh", longname: "LVMH Moët Hennessy", exchDisp: "XPAR", quoteType: "EQUITY", sector: "Consumer Cyclical", industry: "Luxury Goods" }, { shortname: "no symbol" }, { symbol: "^FCHI" }] });
    expect(hits).toEqual([
      { symbol: "MC.PA", name: "LVMH Moët Hennessy", exchange: "XPAR", type: "EQUITY", sector: "Consumer Cyclical", industry: "Luxury Goods" },
      { symbol: "^FCHI", name: "^FCHI", exchange: null, type: "EQUITY", sector: null, industry: null },
    ]);
  });

  it("reads company figures by year, by quarter and over the last twelve months", () => {
    const point = (day: string, raw: number, currencyCode = "USD") => ({ asOfDate: day, currencyCode, reportedValue: { raw } });
    const f = parseFundamentals({
      timeseries: {
        result: [
          { meta: { type: ["annualTotalRevenue"] }, annualTotalRevenue: [point("2025-09-30", 416e9), point("2024-09-30", 391e9), null] },
          { meta: { type: ["quarterlyDilutedEPS"] }, quarterlyDilutedEPS: [point("2026-06-30", 2.02)] },
          { meta: { type: ["trailingPeRatio"] }, trailingPeRatio: [{ asOfDate: "2026-11-06", reportedValue: { raw: 38 } }, { asOfDate: "2026-11-09", reportedValue: { raw: 39.05 } }] },
          { meta: { type: ["annualSomethingElse"] }, annualSomethingElse: [point("2025-09-30", 1)] },
          { meta: { type: ["annualNetIncome"] } },
        ],
      },
    });
    expect(f).toEqual({
      currency: "USD",
      annual: { TotalRevenue: [{ day: "2024-09-30", value: 391e9 }, { day: "2025-09-30", value: 416e9 }] },
      quarterly: { DilutedEPS: [{ day: "2026-06-30", value: 2.02 }] },
      trailing: { PeRatio: 39.05 },
    });
    expect(() => parseFundamentals({ timeseries: { result: null, error: { description: "Not found" } } })).toThrow("Not found");
  });
});

/** A share in euros: two buys, a dividend, a partial sale. */
const AAA: Market = {
  name: "Triple A",
  currency: "EUR",
  price: 160,
  change: 6.6667,
  days: ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"],
  closes: [100, 120, 130, 150, 160],
  dividends: [{ day: "2024-01-04", amount: 2 }],
  splits: [],
};
const AAA_TRADES: Trade[] = [
  { symbol: "AAA", kind: "sell", day: "2024-01-05", quantity: 5, price: 150, fees: 2 },
  { symbol: "AAA", kind: "buy", day: "2024-01-02", quantity: 10, price: 100, fees: 5 },
  { symbol: "AAA", kind: "buy", day: "2024-01-03", quantity: 10, price: 120, fees: 0 },
];
/** A share in dollars that split four for one after the buy (Yahoo's closes are already restated). */
const BBB: Market = {
  name: "Bee",
  currency: "USD",
  price: 110,
  change: 0,
  days: ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"],
  closes: [100, 101, 102, 105, 110],
  dividends: [],
  splits: [{ day: "2024-01-04", ratio: 4 }],
};
const euro = makeFx("EUR", new Map([["USD", { days: ["2024-01-01"], closes: [0.9] }]]));

describe("portfolio arithmetic", () => {
  it("finds the value on a day, or the last one before it", () => {
    const s = { days: ["2024-01-02", "2024-01-04"], closes: [10, 20] };
    expect(valueAt(s, "2024-01-01")).toBe(10);
    expect(valueAt(s, "2024-01-02")).toBe(10);
    expect(valueAt(s, "2024-01-03")).toBe(10);
    expect(valueAt(s, "2024-01-09")).toBe(20);
    expect(valueAt({ days: [], closes: [] }, "2024-01-01")).toBeUndefined();
  });

  it("converts currencies, pence included, and reports one it has no rate for", () => {
    const missing: string[] = [];
    const fx = makeFx("EUR", new Map([["GBP", { days: ["2024-01-01", "2024-02-01"], closes: [1.15, 1.2] }]]), (c) => missing.push(c));
    expect(fx("EUR", "2024-01-15")).toBe(1);
    expect(fx("GBP", "2024-01-15")).toBe(1.15);
    expect(fx("GBp", "2024-02-15")).toBeCloseTo(0.012);
    expect(fx("JPY", "2024-01-15")).toBe(1);
    expect(missing).toEqual(["JPY"]);
    expect(makeFx("GBP", new Map())("GBp", "2024-01-01")).toBe(0.01);
  });

  it("restates trades made before a split", () => {
    const [before, after] = adjustForSplits(
      [
        { symbol: "BBB", kind: "buy", day: "2024-01-02", quantity: 1, price: 400, fees: 1 },
        { symbol: "BBB", kind: "buy", day: "2024-01-04", quantity: 1, price: 102, fees: 1 },
      ],
      BBB.splits,
    );
    expect(before).toMatchObject({ quantity: 4, price: 100, fees: 1 });
    expect(after).toMatchObject({ quantity: 1, price: 102 });
  });

  it("works out a position at average cost, with gains made and dividends received", () => {
    const s = summarize(AAA_TRADES, new Map([["AAA", AAA]]), euro, "EUR", "2024-01-08");
    const [p] = s.positions;
    // 20 shares cost 2205 (fees in): 110.25 each. Selling 5 for 748 net makes 748 - 551.25.
    expect(p).toMatchObject({ symbol: "AAA", name: "Triple A", quantity: 15, price: 160, value: 2400, weight: 1, unpriced: false });
    expect(p.avgCost).toBeCloseTo(110.25);
    expect(p.cost).toBeCloseTo(1653.75);
    expect(p.gain).toBeCloseTo(746.25);
    expect(p.gainPct).toBeCloseTo(45.1247);
    expect(p.realized).toBeCloseTo(196.75);
    // 2 a share on the 20 held before the ex-dividend day.
    expect(p.dividends).toBe(40);
    expect(s).toMatchObject({ value: 2400, dividends: 40, dividendYears: [{ year: "2024", amount: 40 }], dividendList: [{ day: "2024-01-04", symbol: "AAA", amount: 40 }], closed: [] });
    expect(s.dayChange).toBeCloseTo(150, 0);
  });

  it("follows the value day by day, and a return that ignores money going in and out", () => {
    const { series } = summarize(AAA_TRADES, new Map([["AAA", AAA]]), euro, "EUR", "2024-01-08", { days: ["2024-01-02", "2024-01-08"], closes: [5000, 5500] });
    expect(series.days).toEqual(AAA.days);
    expect(series.value).toEqual([1000, 2400, 2600, 2250, 2400]);
    expect(series.invested).toEqual([1005, 2205, 2205, 1457, 1457]);
    // (1000/1005) × (1 + 200/2200) × (1 + 200/2400) × (1 + 398/2600) × (1 + 150/2250)
    expect(series.performance[0]).toBeCloseTo(-0.4975);
    expect(series.performance[4]).toBeCloseTo(44.634, 2);
    expect(series.benchmark).toEqual([0, 0, 0, 0, expect.closeTo(10)]);
  });

  it("values foreign shares in the portfolio's currency, after a split", () => {
    const trades: Trade[] = [...AAA_TRADES, { symbol: "BBB", kind: "buy", day: "2024-01-02", quantity: 1, price: 400, fees: 0 }];
    const s = summarize(trades, new Map([["AAA", AAA], ["BBB", BBB]]), euro, "EUR", "2024-01-08");
    const b = s.positions.find((p) => p.symbol === "BBB")!;
    expect(b).toMatchObject({ quantity: 4, avgCost: 100, currency: "USD" });
    expect(b.cost).toBeCloseTo(360);
    expect(b.value).toBeCloseTo(396);
    expect(s.value).toBeCloseTo(2796);
    expect(s.positions.map((p) => p.symbol)).toEqual(["AAA", "BBB"]);
    expect(b.weight).toBeCloseTo(396 / 2796);
    // First day: 10 AAA at 100, and 4 BBB at 100 dollars.
    expect(s.series.value[0]).toBeCloseTo(1360);
  });

  it("keeps sold positions apart, and prices an unknown symbol at the last price paid", () => {
    const s = summarize(
      [
        { symbol: "AAA", kind: "buy", day: "2024-01-02", quantity: 10, price: 100, fees: 0 },
        { symbol: "AAA", kind: "sell", day: "2024-01-05", quantity: 99, price: 150, fees: 0 },
        { symbol: "GONE", kind: "buy", day: "2024-01-03", quantity: 2, price: 50, fees: 0 },
      ],
      new Map([["AAA", AAA]]),
      euro,
      "EUR",
      "2024-01-08",
    );
    expect(s.closed).toMatchObject([{ symbol: "AAA", quantity: 0, realized: 500 }]);
    expect(s.positions).toMatchObject([{ symbol: "GONE", value: 100, unpriced: true, gain: 0 }]);
    expect(summarize([], new Map(), euro, "EUR", "2024-01-08")).toMatchObject({ value: 0, gainPct: null, positions: [], series: { days: [] } });
  });

  it("sums dividends per year and thins long series", () => {
    expect(dividendsByYear([{ day: "2025-04-01", amount: 1 }, { day: "2024-04-01", amount: 2 }, { day: "2025-11-01", amount: 1.5 }])).toEqual([
      { year: "2024", amount: 2 },
      { year: "2025", amount: 2.5 },
    ]);
    const long = { days: Array.from({ length: 1000 }, (_, i) => String(i).padStart(4, "0")), closes: Array.from({ length: 1000 }, (_, i) => i) };
    const short = thin(long, 100);
    expect(short.days.length).toBeLessThanOrEqual(100);
    expect(short.closes[short.closes.length - 1]).toBe(999);
    expect(thin(long, 5000)).toBe(long);
  });
});

describe("stocks store", () => {
  let me = 0;
  let other = 0;
  beforeEach(() => {
    db().exec("DELETE FROM stock_portfolios; DELETE FROM stock_watch; DELETE FROM stock_cache; DELETE FROM users;");
    forget("stocks:");
    me = user("me");
    other = user("other");
  });
  const mine = () => ensurePortfolios(me, "Main portfolio", "EUR")[0];
  const buy = { symbol: "aapl", kind: "buy", date: "2024-01-02", quantity: "1,5", price: 180, fees: "" };

  it("gives a first portfolio, and keeps portfolios and trades private", () => {
    const p = mine();
    expect(p).toMatchObject({ name: "Main portfolio", currency: "EUR" });
    expect(ensurePortfolios(me, "x", "USD")).toHaveLength(1);
    addTransaction(me, { ...buy, portfolio: p.id }, "USD");
    expect(listTransactions(me)).toMatchObject([{ symbol: "AAPL", kind: "buy", quantity: 1.5, price: 180, fees: 0, currency: "USD", portfolio_id: p.id }]);
    expect(listTransactions(other)).toEqual([]);
    const id = listTransactions(me)[0].id;
    expect(() => addTransaction(other, { ...buy, portfolio: p.id }, "USD")).toThrow(/No such portfolio/);
    expect(() => updateTransaction(other, { ...buy, id, portfolio: p.id }, "USD")).toThrow(/No such transaction/);
    expect(() => deleteTransaction(other, id)).toThrow(/No such transaction/);
    expect(() => deletePortfolio(other, p.id)).toThrow(/No such portfolio/);
  });

  it("refuses trades that make no sense", () => {
    const portfolio = mine().id;
    const bad = (change: Record<string, unknown>) => () => addTransaction(me, { ...buy, portfolio, ...change }, "USD");
    expect(bad({ symbol: "not a symbol!" })).toThrow(/symbol/);
    expect(bad({ quantity: 0 })).toThrow(/quantity/);
    expect(bad({ price: -1 })).toThrow(/price/);
    expect(bad({ date: "2999-01-01" })).toThrow(/future/);
    expect(bad({ date: "yesterday" })).toThrow(/YYYY-MM-DD/);
    expect(bad({ fees: -2 })).toThrow(/fees/);
    expect(listTransactions(me)).toEqual([]);
  });

  it("edits and deletes trades, filters by portfolio, and keeps the last portfolio", () => {
    const first = mine();
    addPortfolio(me, { name: "PEA", currency: "eur" });
    const second = ensurePortfolios(me, "", "")[1];
    addTransaction(me, { ...buy, portfolio: first.id }, "USD");
    addTransaction(me, { ...buy, portfolio: second.id, symbol: "MC.PA", date: "2024-02-01" }, "EUR");
    expect(listTransactions(me).map((t) => t.symbol)).toEqual(["MC.PA", "AAPL"]);
    expect(listTransactions(me, second.id).map((t) => t.symbol)).toEqual(["MC.PA"]);
    const id = listTransactions(me, first.id)[0].id;
    updateTransaction(me, { ...buy, id, portfolio: second.id, kind: "sell", quantity: 2 }, "USD");
    expect(listTransactions(me, second.id)).toHaveLength(2);
    deleteTransaction(me, id);
    deletePortfolio(me, second.id);
    expect(listTransactions(me)).toEqual([]);
    expect(() => deletePortfolio(me, first.id)).toThrow(/at least one/);
    expect(() => addPortfolio(me, { name: "x", currency: "euro" })).toThrow(/three letters/);
  });

  it("watches symbols", () => {
    watch(me, "mc.pa");
    watch(me, "MC.PA");
    watch(me, "^GSPC");
    expect(listWatched(me)).toEqual(["MC.PA", "^GSPC"]);
    expect(listWatched(other)).toEqual([]);
    unwatch(me, "mc.pa");
    expect(listWatched(me)).toEqual(["^GSPC"]);
    expect(() => watch(me, "no way")).toThrow(/symbol/);
  });

  it("remembers what Yahoo said: fresh answers aren't asked again, the last one is served when Yahoo fails", async () => {
    const ask = vi.fn(async () => ({ price: 1 }));
    expect(await remembered("k", 60_000, ask)).toEqual({ price: 1 });
    expect(await remembered("k", 60_000, ask)).toEqual({ price: 1 });
    // After a restart the database still has it.
    forget("stocks:");
    expect(await remembered("k", 60_000, ask)).toEqual({ price: 1 });
    expect(ask).toHaveBeenCalledTimes(1);

    // Too old to trust: asked again; when that fails, the old answer is better than none.
    db().prepare("UPDATE stock_cache SET at = at - 120000").run();
    forget("stocks:");
    const down = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await remembered("k", 60_000, down)).toEqual({ price: 1 });
    expect(down).toHaveBeenCalledTimes(1);
    forget("stocks:");
    expect(await remembered("k", 60_000, async () => ({ price: 2 }))).toEqual({ price: 2 });
    await expect(remembered("never-seen", 60_000, down)).rejects.toThrow("ECONNRESET");
  });

  it("puts trades and market data together for the pages", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const history = (symbol: string, currency: string, closes: number[], extra: Partial<History> = {}): History => ({
      symbol,
      name: `${symbol} Inc`,
      currency,
      exchange: "Test",
      price: closes[closes.length - 1],
      change: 1,
      high52: 500,
      low52: 50,
      days: ["2024-01-02", "2024-01-03", today].slice(-closes.length),
      closes,
      dividends: [],
      splits: [],
      ...extra,
    });
    const asked: string[] = [];
    vi.spyOn(yahoo, "fetchHistory").mockImplementation(async (symbol) => {
      asked.push(symbol);
      if (symbol === "AAPL") return history("AAPL", "USD", [100, 110, 200], { dividends: [{ day: "2024-06-01", amount: 1 }] });
      if (symbol === "USDEUR=X") return history(symbol, "EUR", [0.9, 0.9, 0.9]);
      if (symbol === "^GSPC") return history(symbol, "USD", [4000, 4100, 5000]);
      throw new Error("No data found, symbol may be delisted");
    });
    vi.spyOn(yahoo, "searchSymbols").mockResolvedValue([{ symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", type: "EQUITY", sector: "Technology", industry: "Consumer Electronics" }]);
    vi.spyOn(yahoo, "fetchFundamentals").mockResolvedValue({ currency: "USD", annual: { TotalRevenue: [{ day: "2025-09-30", value: 416e9 }] }, quarterly: {}, trailing: { PeRatio: 39 } });

    const portfolios = ensurePortfolios(me, "Main portfolio", "EUR");
    addTransaction(me, { ...buy, quantity: 10, price: 100, portfolio: portfolios[0].id }, "USD");
    addTransaction(me, { ...buy, symbol: "DEAD", quantity: 1, price: 20, date: "2024-01-03", portfolio: portfolios[0].id }, "EUR");

    const data = await loadStocks(me, portfolios, portfolios[0].id, "nonsense");
    expect(data).toMatchObject({ currency: "EUR", portfolio: portfolios[0].id, benchmark: "^GSPC" });
    expect(data.errors).toEqual([expect.stringMatching(/^DEAD: .*delisted/)]);
    expect(asked).toEqual(expect.arrayContaining(["AAPL", "DEAD", "^GSPC", "USDEUR=X"]));
    const apple = data.positions.find((p) => p.symbol === "AAPL")!;
    expect(apple).toMatchObject({ quantity: 10, sector: "Technology", currency: "USD" });
    expect(apple.value).toBeCloseTo(1800);
    expect(apple.cost).toBeCloseTo(900);
    expect(apple.dividends).toBeCloseTo(9);
    expect(data.positions.find((p) => p.symbol === "DEAD")).toMatchObject({ unpriced: true, value: 20 });
    expect(data.transactions).toHaveLength(2);
    expect(data.series.days[0]).toBe("2024-01-02");
    expect(data.series.benchmark?.[data.series.benchmark.length - 1]).toBeCloseTo(25);

    const research = await loadResearch(me, "AAPL", "max");
    expect(research).toMatchObject({ symbol: "AAPL", name: "AAPL Inc", sector: "Technology", price: 200, watched: false, holding: { quantity: 10, avgCost: 100 } });
    expect(research.fundamentals?.trailing.PeRatio).toBe(39);
    expect(research.dividends).toEqual([{ year: "2024", amount: 1 }]);

    watch(me, "AAPL");
    watch(me, "DEAD");
    expect(await loadWatchlist(me)).toMatchObject([
      { symbol: "AAPL", price: 200, change: 1 },
      { symbol: "DEAD", price: null, closes: [] },
    ]);
    vi.restoreAllMocks();
  });
});
