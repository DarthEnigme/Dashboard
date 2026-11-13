import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { forget } from "@/lib/cache";
import { CONFIG_DIR } from "@/lib/config/load";
import { configuredChannels, onlyChannels } from "@/lib/alerts";
import { decide, read, type AlertContext, type AlertRule } from "@/lib/stocks/alerts";
import { addAlert, listAlerts, markFired, updateAlert } from "@/lib/stocks/alertStore";
import { stockAlertJob } from "@/lib/stocks/alertJob";
import { cagr, divideSeries, latestOf, seriesOf, type SymbolFacts } from "@/lib/stocks/metrics";
import { betaAndCorrelation, pairedReturns, rebased } from "@/lib/stocks/stats";
import { composition } from "@/lib/stocks/composition";
import { dayOf, kindOf, numberOf, readTrades } from "@/lib/stocks/import/presets";
import { prepareImport, resolveTrades, rowsOf, saveTrades } from "@/lib/stocks/import";
import { tradeRows } from "@/lib/stocks/brokers/ibkr";
import { tradeOf } from "@/lib/stocks/brokers/trading212";
import { addConnection, listConnections, startSync } from "@/lib/stocks/brokers/sync";
import { transactionsTable } from "@/lib/stocks/exports";
import { addTransaction, ensurePortfolios, listTransactions } from "@/lib/stocks/store";
import * as yahoo from "@/lib/stocks/yahoo";
import * as service from "@/lib/stocks/service";
import { parseSummary, type History } from "@/lib/stocks/yahoo";
import { writeXlsx, colName } from "@/lib/xlsxWrite";
import { readXlsx } from "@/lib/finance/xlsx";
import { layoutLayers } from "@/components/charts/sankeyLayout";

const user = (name: string) => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, 'user', ?)").run(name, Date.now()).lastInsertRowid);
let me = 0;

beforeEach(() => {
  db().exec("DELETE FROM stock_portfolios; DELETE FROM stock_alerts; DELETE FROM stock_cache; DELETE FROM users;");
  forget("stocks:");
  me = user("me");
});
afterEach(() => vi.restoreAllMocks());

/** A Yahoo history with steady closes, for mocks. */
const history = (symbol: string, currency: string, price: number, extra: Partial<History> = {}): History => ({
  symbol,
  name: `${symbol} Inc`,
  currency,
  exchange: "Test",
  price,
  change: 1,
  high52: null,
  low52: null,
  days: ["2026-01-02", "2026-01-05"],
  closes: [price, price],
  dividends: [],
  splits: [],
  ...extra,
});

describe("measures", () => {
  const facts: SymbolFacts = {
    symbol: "X",
    price: 100,
    company: null,
    fundamentals: {
      currency: "USD",
      annual: {
        TotalRevenue: [
          { day: "2022-12-31", value: 100 },
          { day: "2023-12-31", value: 110 },
          { day: "2024-12-31", value: 121 },
          { day: "2025-12-31", value: 133.1 },
        ],
        NetIncome: [
          { day: "2024-12-31", value: 12 },
          { day: "2025-12-31", value: 20 },
        ],
        TotalDebt: [{ day: "2025-12-31", value: 50 }],
        CashAndCashEquivalents: [{ day: "2025-12-31", value: 10 }],
        EBITDA: [{ day: "2025-12-31", value: 20 }],
        CashDividendsPaid: [{ day: "2025-12-31", value: -5 }],
      },
      quarterly: {},
      trailing: { MarketCap: 1000, FreeCashFlow: 50 },
    },
  };

  it("works ratios, growth and market figures out of the reported ones", () => {
    expect(seriesOf("netMargin", facts, "annual").map((p) => Math.round(p.value * 100) / 100)).toEqual([9.92, 15.03]);
    expect(seriesOf("revenueGrowth", facts, "annual").map((p) => Math.round(p.value))).toEqual([10, 10, 10]);
    expect(latestOf("revenueCagr3", facts)).toBeCloseTo(10);
    expect(latestOf("netDebtToEbitda", facts)).toBeCloseTo(2);
    expect(latestOf("payout", facts)).toBeCloseTo(25);
    expect(latestOf("fcfYield", facts)).toBeCloseTo(5);
    expect(latestOf("price", facts)).toBe(100);
    expect(latestOf("nonsense", facts)).toBeNull();
    expect(cagr([{ day: "2025-12-31", value: 1 }], 3)).toBeNull();
  });

  it("divides two companies' figures period by period, though their years end on different days", () => {
    const a = [
      { day: "2024-12-31", value: 10 },
      { day: "2025-12-31", value: 20 },
    ];
    const b = [
      { day: "2024-09-30", value: 5 },
      { day: "2025-09-30", value: 4 },
    ];
    expect(divideSeries(a, b, "annual")).toEqual([
      { period: "2024", value: 2 },
      { period: "2025", value: 5 },
    ]);
  });
});

describe("how prices move together", () => {
  const days = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
  const bench = { days, closes: days.map((_, i) => 100 * (1 + (i % 2 ? 0.01 : -0.01)) ** i) };

  it("finds a beta of 2 for something that moves twice as much", () => {
    const [rb] = pairedReturns(bench, bench);
    let price = 50;
    const twice = { days, closes: [50, ...rb.map((r) => (price *= 1 + 2 * r))] };
    const { beta, correlation } = betaAndCorrelation(twice, bench);
    expect(beta).toBeCloseTo(2);
    expect(correlation).toBeCloseTo(1);
    expect(betaAndCorrelation({ days: days.slice(0, 5), closes: [1, 2, 3, 4, 5] }, bench)).toEqual({ beta: null, correlation: null });
  });

  it("rebases a series to 100", () => {
    expect(rebased({ days: ["a", "b"], closes: [50, 75] }).closes).toEqual([100, 150]);
  });
});

describe("Yahoo's quote summary", () => {
  it("reads the profile, calendar, analysts and holders, leaving out what is missing", () => {
    const c = parseSummary({
      quoteSummary: {
        result: [
          {
            assetProfile: { country: "France", website: "https://www.lvmh.com", fullTimeEmployees: 200000, companyOfficers: [{ name: "B. A.", title: "CEO" }, { title: "no name" }] },
            calendarEvents: { earnings: { earningsDate: [{ raw: 1798761600 }] }, exDividendDate: { raw: 1796169600 } },
            financialData: { targetMeanPrice: { raw: 700 }, recommendationKey: "buy", numberOfAnalystOpinions: { raw: 25 } },
            recommendationTrend: { trend: [{ period: "-1m", buy: 1 }, { period: "0m", strongBuy: 5, buy: 10, hold: 6, sell: 1, strongSell: 0 }] },
            majorHoldersBreakdown: { institutionsPercentHeld: { raw: 0.3 } },
            summaryDetail: { trailingPE: { raw: 22 }, dividendYield: 0.02 },
          },
        ],
        error: null,
      },
    });
    expect(c.profile).toMatchObject({ country: "France", employees: 200000, officers: [{ name: "B. A.", title: "CEO" }] });
    expect(c.calendar).toEqual({ earnings: ["2027-01-01"], exDividend: "2026-12-02", dividendPaid: null });
    expect(c.analysts).toMatchObject({ targetMean: 700, targetLow: null, recommendation: "buy", count: 25, trend: { strongBuy: 5, buy: 10, hold: 6, sell: 1, strongSell: 0 } });
    expect(c.holders).toMatchObject({ institutions: 0.3, insiders: null, top: [] });
    expect(c.stats).toMatchObject({ trailingPE: 22, dividendYield: 0.02, beta: null });
    expect(() => parseSummary({ quoteSummary: { result: null, error: { description: "Quote not found" } } })).toThrow(/Quote not found/);
  });
});

describe("alert rules", () => {
  const rule = (r: Partial<AlertRule>): AlertRule => ({ id: 1, kind: "price", symbol: "AAPL", portfolio_id: null, op: "above", value: 150, channels: [], note: null, active: true, fired_key: null, fired_at: null, ...r });
  const ctx = (price: number, extra: Partial<AlertContext> = {}): AlertContext => ({
    today: "2026-11-11",
    quote: () => ({ price, change: -4, currency: "USD", name: "Apple" }),
    position: () => ({ gainPct: 25 }),
    portfolio: () => ({ name: "PEA", value: 10_000, dayChangePct: -3, currency: "EUR" }),
    company: () => null,
    ...extra,
  });

  it("fires once when a price crosses, and again only after it went back", () => {
    let r = rule({});
    const step = (price: number) => {
      const d = decide(r, read(r, ctx(price)));
      r = { ...r, fired_key: d.key };
      return !!d.send;
    };
    expect([step(140), step(155), step(160), step(149), step(151)]).toEqual([false, true, false, false, true]);
  });

  it("reads moves, positions, portfolios and events", () => {
    expect(read(rule({ kind: "move", op: "down", value: 3 }), ctx(100))).toMatchObject({ holds: true, dated: true, key: "move:down:3:2026-11-11" });
    expect(read(rule({ kind: "position", op: "gain", value: 20 }), ctx(100))?.holds).toBe(true);
    expect(read(rule({ kind: "position", op: "loss", value: 20 }), ctx(100))?.holds).toBe(false);
    expect(read(rule({ kind: "portfolio", op: "below", value: 12_000, symbol: null }), ctx(100))?.message).toMatch(/PEA is below 12,000 EUR/);
    expect(read(rule({ kind: "portfolio", op: "dayDown", value: 2, symbol: null }), ctx(100))?.holds).toBe(true);
    const company = { calendar: { earnings: ["2026-11-20"], exDividend: null, dividendPaid: null } } as never;
    expect(read(rule({ kind: "event", op: "earnings", value: 10 }), ctx(100, { company: () => company }))).toMatchObject({ holds: true, key: "event:earnings:10:2026-11-20" });
    expect(read(rule({ kind: "event", op: "earnings", value: 5 }), ctx(100, { company: () => company }))?.holds).toBe(false);
    // Missing data: nothing is decided, the rule keeps its state.
    expect(decide(rule({ fired_key: "x" }), read(rule({}), ctx(100, { quote: () => undefined })))).toEqual({ key: "x" });
  });

  it("compares every condition with its threshold, the threshold itself included", () => {
    // Today's change is -4 %, the position +25 %, the portfolio 10,000 and -3 % today.
    const holds = (kind: AlertRule["kind"], op: string, value: number) => read(rule({ kind, op, value, symbol: kind === "portfolio" ? null : "AAPL" }), ctx(100))?.holds;
    expect([holds("price", "above", 100), holds("price", "above", 101), holds("price", "below", 100), holds("price", "below", 99)]).toEqual([true, false, true, false]);
    expect([holds("move", "up", 4), holds("move", "down", 4), holds("move", "down", 5), holds("move", "either", 4), holds("move", "either", 5)]).toEqual([false, true, false, true, false]);
    expect([holds("position", "gain", 25), holds("position", "loss", 25)]).toEqual([true, false]);
    expect([holds("portfolio", "above", 10_000), holds("portfolio", "dayUp", 1), holds("portfolio", "dayDown", 3)]).toEqual([true, false, true]);
    // An event today counts; one in the past doesn't.
    const on = (day: string) => read(rule({ kind: "event", op: "exDividend", value: 0 }), ctx(100, { company: () => ({ calendar: { earnings: [], exDividend: day, dividendPaid: null } }) as never }))?.holds;
    expect([on("2026-11-11"), on("2026-11-10")]).toEqual([true, false]);
    // A condition the kind doesn't have reads as nothing.
    expect(holds("price", "dayUp", 1)).toBeUndefined();
  });

  it("keeps rules private and checks them", () => {
    addAlert(me, { kind: "price", op: "above", value: 150, symbol: "aapl", channels: ["discord"] });
    const [a] = listAlerts(me);
    expect(a).toMatchObject({ symbol: "AAPL", channels: ["discord"], active: true });
    expect(() => addAlert(me, { kind: "price", op: "sideways", value: 1, symbol: "AAPL" })).toThrow(/condition/);
    expect(() => addAlert(me, { kind: "price", op: "above", value: 1, symbol: "AAPL", channels: ["carrier pigeon"] })).toThrow(/channel/);
    expect(() => updateAlert(user("other"), { id: a.id, kind: "price", op: "below", value: 1, symbol: "AAPL" })).toThrow(/No such alert/);
  });

  it("keeps what a rule fired on when it is paused and resumed, not when its condition changes", () => {
    addAlert(me, { kind: "price", op: "above", value: 150, symbol: "AAPL" });
    const [a] = listAlerts(me);
    markFired(a, "price:above:150", true);
    const body = { ...a, portfolio: a.portfolio_id };
    updateAlert(me, { ...body, active: false });
    updateAlert(me, { ...body, active: true, note: "sell some" });
    expect(listAlerts(me)[0]).toMatchObject({ fired_key: "price:above:150", note: "sell some" });
    updateAlert(me, { ...body, value: 160 });
    expect(listAlerts(me)[0]).toMatchObject({ fired_key: null, fired_at: null });
  });

  it("doesn't mark a rule fired when it was edited while the job ran", () => {
    addAlert(me, { kind: "price", op: "above", value: 150, symbol: "AAPL" });
    const [seen] = listAlerts(me);
    updateAlert(me, { ...seen, portfolio: seen.portfolio_id, value: 170 });
    markFired(seen, "price:above:150", true);
    expect(listAlerts(me)[0].fired_key).toBeNull();
  });

  it("sends only to the channels a rule names", () => {
    const cfg = { discord: "https://discord/x", ntfy: "https://ntfy/x", threshold: 2, certDays: 14 } as never;
    expect(configuredChannels(cfg)).toEqual(["discord", "ntfy"]);
    expect(configuredChannels(onlyChannels(cfg, ["ntfy"]))).toEqual(["ntfy"]);
    expect(onlyChannels(cfg, [])).toBe(cfg);
  });

  describe("the job", () => {
    let server: http.Server;
    const hooks: { kind: string; message: string }[] = [];
    const settings = path.join(CONFIG_DIR, "settings.yaml");
    let before: string | undefined;
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => {
          hooks.push(JSON.parse(b));
          res.end("ok");
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      before = fs.existsSync(settings) ? fs.readFileSync(settings, "utf8") : undefined;
      fs.writeFileSync(settings, `title: Test\nalerts:\n  webhook: http://127.0.0.1:${(server.address() as AddressInfo).port}/hook\n`);
    });
    afterAll(() => {
      server.close();
      if (before === undefined) fs.rmSync(settings, { force: true });
      else fs.writeFileSync(settings, before);
    });

    it("tells the channels when a price crosses, once", async () => {
      vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("AAPL", "USD", 200));
      addAlert(me, { kind: "price", op: "above", value: 150, symbol: "AAPL" });
      addAlert(me, { kind: "price", op: "below", value: 150, symbol: "AAPL" });
      await stockAlertJob();
      await stockAlertJob();
      expect(hooks.map((h) => [h.kind, h.message])).toEqual([["stock", "AAPL (AAPL Inc) is above 150 USD: 200 USD now."]]);
      expect(listAlerts(me).find((a) => a.op === "above")?.fired_key).toBe("price:above:150");
    });
  });
});

describe("importing trades", () => {
  it("reads numbers, days and sides the way brokers write them", () => {
    expect([numberOf("1.234,56"), numberOf("1,234.56"), numberOf("-12,5"), numberOf("€ 3"), numberOf("x")]).toEqual([1234.56, 1234.56, -12.5, 3, null]);
    expect([dayOf("2024-01-15 10:00:00"), dayOf("20240115"), dayOf("15-01-2024"), dayOf("15/01/2024"), dayOf("2024-13-01")]).toEqual(["2024-01-15", "2024-01-15", "2024-01-15", "2024-01-15", null]);
    expect([kindOf("Market buy"), kindOf("Vente"), kindOf("Kauf"), kindOf("Dividend")]).toEqual(["buy", "sell", "buy", null]);
  });

  it("knows Degiro's export, with its unnamed currency column and negative sells", () => {
    const rows = [
      ["Date", "Heure", "Produit", "Code ISIN", "Place boursiè", "Lieu d'exécution", "Quantité", "Cours", "", "Montant devise locale", "", "Montant", "", "Taux de change", "Frais de courtage", "", "Montant négocié", "", "ID Ordre"],
      ["15-01-2024", "10:00", "LVMH", "FR0000121014", "EPA", "XPAR", "2", "700,50", "EUR", "-1401", "EUR", "-1401", "EUR", "", "-2,00", "EUR", "-1403", "EUR", "abc-1"],
      ["16-01-2024", "11:00", "APPLE INC", "US0378331005", "NDQ", "XNAS", "-1", "190", "USD", "190", "USD", "175", "EUR", "1.08", "-1", "EUR", "174", "EUR", "abc-2"],
    ];
    const { preset, trades, errors } = readTrades(rows);
    expect(preset.id).toBe("degiro");
    expect(errors).toEqual([]);
    expect(trades.map((t) => [t.isin, t.kind, t.date, t.quantity, t.price, t.fees, t.currency, t.externalId])).toEqual([
      ["FR0000121014", "buy", "2024-01-15", 2, 700.5, 2, "EUR", "degiro:abc-1"],
      ["US0378331005", "sell", "2024-01-16", 1, 190, 1, "USD", "degiro:abc-2"],
    ]);
  });

  it("skips what isn't a trade and fingerprints lines without an id", () => {
    const rows = [
      ["Date", "Type", "ISIN", "Shares", "Price", "Fee"],
      ["2024-02-01", "Buy", "US0378331005", "3", "180", "1"],
      ["2024-02-01", "Buy", "US0378331005", "3", "180", "1"],
      ["2024-02-02", "Dividend", "US0378331005", "", "", ""],
      ["nonsense", "Sell", "US0378331005", "1", "1", "0"],
    ];
    const { preset, trades, errors } = readTrades(rows);
    expect(preset.id).toBe("generic");
    expect(trades).toHaveLength(2);
    expect(trades[0].externalId).not.toBe(trades[1].externalId);
    expect(errors).toEqual(['Line 5: unreadable date "nonsense"']);
    // The same file again gives the same ids.
    expect(readTrades(rows).trades.map((t) => t.externalId)).toEqual(trades.map((t) => t.externalId));
  });

  it("finds symbols from ISINs, shows duplicates, and adds a file only once", async () => {
    vi.spyOn(yahoo, "searchSymbols").mockImplementation(async (q) => (q === "US0378331005" ? [{ symbol: "AAPL", name: "Apple", exchange: "NMS", type: "EQUITY", sector: null, industry: null }] : []));
    vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("AAPL", "USD", 200));
    const [p] = ensurePortfolios(me, "Main", "EUR");
    const rows = [
      ["Date", "Type", "ISIN", "Shares", "Price", "Currency", "ID"],
      ["2024-02-01", "Buy", "US0378331005", "3", "180", "USD", "t1"],
      ["2024-02-03", "Buy", "XS0000000000", "1", "10", "EUR", "t2"],
    ];
    const first = await prepareImport(me, p.id, rows);
    expect(first.trades.map((t) => [t.yahoo, t.duplicate, t.problem])).toEqual([
      ["AAPL", false, null],
      [null, false, "Yahoo Finance doesn't know XS0000000000"],
    ]);
    expect(saveTrades(me, p.id, first.trades, "Test")).toEqual({ added: 1, skipped: 0, unresolved: 1 });
    const again = await prepareImport(me, p.id, rows);
    expect(again.trades[0].duplicate).toBe(true);
    expect(saveTrades(me, p.id, again.trades, "Test")).toMatchObject({ added: 0, skipped: 1 });
    expect(listTransactions(me)).toMatchObject([{ symbol: "AAPL", quantity: 3, price: 180, currency: "USD", external_id: "generic:t1" }]);
  });

  it("imports its own export back unchanged, as CSV or XLSX", async () => {
    vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("AAPL", "USD", 200));
    const [p] = ensurePortfolios(me, "Main", "EUR");
    addTransaction(me, { portfolio: p.id, symbol: "AAPL", kind: "buy", date: "2024-03-01", quantity: 2, price: 150, fees: 1 }, "USD");
    const table = transactionsTable(listTransactions(me), () => "Main");
    const asRows = (t: typeof table) => t.map((r) => r.map((v) => (v === null ? "" : String(v))));
    // The same portfolio: nothing doubles, even for trades typed in by hand.
    const back = await prepareImport(me, p.id, asRows(table));
    expect(back.preset).toBe("nanodash");
    expect(back.trades.map((t) => t.duplicate)).toEqual([true]);
    // Through a spreadsheet file.
    const xlsx = rowsOf("x.xlsx", new Uint8Array(writeXlsx(table)));
    expect(xlsx).toEqual(asRows(table));
    expect(readXlsx(writeXlsx([["a", 1.5], [null, "b"]]))).toEqual([["a", "1.5"], ["", "b"]]);
    expect([colName(0), colName(25), colName(26)]).toEqual(["A", "Z", "AA"]);
  });
});

describe("price histories", () => {
  it("serves every recent window from one request, cut to what was asked", async () => {
    const days = ["2026-10-01", "2026-11-02", "2026-11-09"];
    const fetch = vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("AAPL", "USD", 200, { days, closes: [1, 2, 3], dividends: [{ day: "2026-10-01", amount: 1 }] }));
    const month = await service.history("AAPL", "2026-11-01");
    const week = await service.history("AAPL", "2026-11-05");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect([month.days, month.closes, month.dividends]).toEqual([["2026-11-02", "2026-11-09"], [2, 3], []]);
    expect(week.closes).toEqual([3]);
  });
});

describe("resolving and saving trades", () => {
  const trade = (extra: Record<string, unknown> = {}) => ({ symbol: "VOD.L", isin: null, name: "Vodafone", kind: "buy" as const, date: "2024-05-02", quantity: 10, price: 0.7, fees: 0.05, currency: "GBP", externalId: "x:1", line: 1, ...extra });

  it("moves the fees to pence with the price when Yahoo quotes London in pence", async () => {
    vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("VOD.L", "GBp", 70));
    const [t] = await resolveTrades([trade()]);
    expect(t).toMatchObject({ yahoo: "VOD.L", quoted: "GBp", price: 70, fees: 5 });
  });

  it("leaves out a trade dated after today instead of refusing them all", async () => {
    vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("VOD.L", "GBp", 70));
    const [p] = ensurePortfolios(me, "Main", "EUR");
    const resolved = await resolveTrades([trade(), trade({ date: "2999-01-01", externalId: "x:2" })]);
    expect(saveTrades(me, p.id, resolved, "Test")).toEqual({ added: 1, skipped: 0, unresolved: 1 });
  });
});

describe("brokers", () => {
  it("reads Trading 212 orders in both of its shapes", () => {
    const instruments = new Map([["AAPL_US_EQ", { ticker: "AAPL_US_EQ", isin: "US0378331005", currencyCode: "USD", name: "Apple" }]]);
    expect(tradeOf({ id: 7, ticker: "AAPL_US_EQ", status: "FILLED", filledQuantity: -2, fillPrice: 190, dateExecuted: "2024-05-02T10:00:00Z", taxes: [{ quantity: -0.5 }] }, instruments, 1)).toMatchObject({
      isin: "US0378331005",
      kind: "sell",
      quantity: 2,
      price: 190,
      fees: 0.5,
      date: "2024-05-02",
      externalId: "trading212:7",
    });
    expect(tradeOf({ order: { id: 8, side: "BUY", status: "FILLED", instrument: { ticker: "X", isin: "IE00B4L5Y983", currencyCode: "EUR" } }, fill: { id: 99, quantity: 3, price: 80, filledAt: "2024-06-01T09:00:00Z" } }, new Map(), 2)).toMatchObject({
      isin: "IE00B4L5Y983",
      kind: "buy",
      quantity: 3,
      externalId: "trading212:99",
    });
    expect(tradeOf({ id: 9, status: "CANCELLED" }, instruments, 3)).toBeNull();
    // Without an id, two different trades still get different ids (else the second is taken for the first).
    const noId = (quantity: number) => tradeOf({ ticker: "AAPL_US_EQ", status: "FILLED", filledQuantity: quantity, fillPrice: 190, dateExecuted: "2024-05-02T10:00:00Z" }, instruments, 1)!.externalId;
    expect(noId(1)).not.toBe(noId(2));
    expect(noId(1)).not.toBe("trading212:");
  });

  it("reads an Interactive Brokers Flex statement like its CSV", () => {
    const rows = tradeRows({
      FlexQueryResponse: {
        FlexStatements: {
          FlexStatement: [
            {
              Trades: {
                Trade: [
                  { symbol: "AAPL", isin: "US0378331005", currency: "USD", tradeDate: "20240115", quantity: "10", tradePrice: "185.2", ibCommission: "-1", buySell: "BUY", tradeID: "555", assetCategory: "STK" },
                  { symbol: "ES", currency: "USD", tradeDate: "20240116", quantity: "1", tradePrice: "5000", buySell: "BUY", tradeID: "556", assetCategory: "FUT" },
                ],
              },
            },
          ],
        },
      },
    });
    const { trades } = readTrades(rows, "ibkr");
    expect(trades.map((t) => [t.symbol, t.isin, t.kind, t.date, t.quantity, t.price, t.fees, t.externalId])).toEqual([["AAPL", "US0378331005", "buy", "2024-01-15", 10, 185.2, 1, "ibkr:555"]]);
  });
});

describe("broker connections", () => {
  let server: http.Server;
  const asked: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url!, "http://x");
      asked.push(`${url.pathname} ${req.headers.authorization ?? ""}`);
      const json = (body: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
      const xml = (body: string) => res.writeHead(200, { "Content-Type": "text/xml" }).end(body);
      if (url.pathname === "/api/v0/equity/metadata/instruments") return json([{ ticker: "AAPL_US_EQ", isin: "US0378331005", currencyCode: "USD", name: "Apple" }]);
      if (url.pathname === "/api/v0/equity/history/orders" && !url.searchParams.get("cursor"))
        return json({ items: [{ id: 1, ticker: "AAPL_US_EQ", status: "FILLED", filledQuantity: 2, fillPrice: 100, dateExecuted: "2024-05-02T10:00:00Z" }], nextPagePath: "/api/v0/equity/history/orders?limit=50&cursor=1" });
      if (url.pathname === "/api/v0/equity/history/orders") return json({ items: [{ id: 2, ticker: "AAPL_US_EQ", status: "FILLED", filledQuantity: 1, fillPrice: 110, dateExecuted: "2024-05-03T10:00:00Z" }], nextPagePath: null });
      if (url.pathname === "/flex/SendRequest") return xml(`<FlexStatementResponse><Status>Success</Status><ReferenceCode>42</ReferenceCode><Url>http://127.0.0.1:${(server.address() as AddressInfo).port}/flex/GetStatement</Url></FlexStatementResponse>`);
      if (url.pathname === "/flex/GetStatement" && asked.filter((a) => a.startsWith("/flex/GetStatement")).length === 1)
        return xml("<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress</ErrorMessage></FlexStatementResponse>");
      if (url.pathname === "/flex/GetStatement")
        return xml(`<FlexQueryResponse><FlexStatements count="1"><FlexStatement><Trades><Trade symbol="AAPL" isin="US0378331005" currency="USD" tradeDate="20240115" quantity="5" tradePrice="180" ibCommission="-1" buySell="BUY" tradeID="9" assetCategory="STK"/></Trades></FlexStatement></FlexStatements></FlexQueryResponse>`);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    Object.assign(process.env, { PAGE_T212_URL: base, PAGE_T212_DELAY_MS: "0", PAGE_IBKR_URL: `${base}/flex`, PAGE_IBKR_WAIT_MS: "0" });
  });
  afterAll(() => server.close());

  it("syncs Trading 212 and IBKR into a portfolio, keeping the key sealed", async () => {
    vi.spyOn(yahoo, "searchSymbols").mockResolvedValue([{ symbol: "AAPL", name: "Apple", exchange: "NMS", type: "EQUITY", sector: null, industry: null }]);
    vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("AAPL", "USD", 200));
    const [p] = ensurePortfolios(me, "Main", "EUR");
    const t212 = addConnection(me, { kind: "t212", portfolio: p.id, secret: "key:secret" });
    const ib = addConnection(me, { kind: "ibkr", portfolio: p.id, secret: "tok", account: "123" });
    expect(db().prepare("SELECT secret FROM stock_brokers WHERE id = ?").get(t212)).not.toEqual({ secret: "key:secret" });
    await startSync(me, t212);
    await startSync(me, ib);
    expect(asked).toContain(`/api/v0/equity/history/orders Basic ${Buffer.from("key:secret").toString("base64")}`);
    expect(listTransactions(me).map((t) => [t.symbol, t.quantity, t.external_id]).sort()).toEqual([
      ["AAPL", 1, "trading212:2"],
      ["AAPL", 2, "trading212:1"],
      ["AAPL", 5, "ibkr:9"],
    ]);
    expect(listConnections(me).map((c) => [c.kind, c.error, c.added])).toEqual([
      ["t212", null, 2],
      ["ibkr", null, 1],
    ]);
    // Again: nothing new.
    await startSync(me, t212);
    expect(listTransactions(me)).toHaveLength(3);
    expect(listConnections(me).find((c) => c.id === t212)).toMatchObject({ syncing: false, added: 0 });
    expect(() => addConnection(me, { kind: "ibkr", portfolio: p.id, secret: "tok" })).toThrow(/query id/);
  });

  it("keeps a sync's progress in the database: one running elsewhere isn't started twice, a crashed one is taken over", async () => {
    vi.spyOn(yahoo, "searchSymbols").mockResolvedValue([{ symbol: "AAPL", name: "Apple", exchange: "NMS", type: "EQUITY", sector: null, industry: null }]);
    vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("AAPL", "USD", 200));
    const [p] = ensurePortfolios(me, "Main", "EUR");
    const id = addConnection(me, { kind: "t212", portfolio: p.id, secret: "key" });
    const started = (at: number | null) => db().prepare("UPDATE stock_brokers SET sync_started_at = ? WHERE id = ?").run(at, id);
    const before = asked.length;

    // Another process (or the instance before a restart) is syncing it: shown, and not started again.
    started(Date.now() - 60_000);
    expect(listConnections(me).find((c) => c.id === id)?.syncing).toBe(true);
    await startSync(me, id);
    expect(asked.length).toBe(before);

    // A sync that started an hour ago crashed: the next one takes over and clears the mark.
    started(Date.now() - 3_600_000);
    expect(listConnections(me).find((c) => c.id === id)?.syncing).toBe(false);
    await startSync(me, id);
    expect(asked.length).toBeGreaterThan(before);
    const after = db().prepare("SELECT sync_started_at, last_added, error FROM stock_brokers WHERE id = ?").get(id);
    expect(after).toEqual({ sync_started_at: null, last_added: expect.any(Number), error: null });
  });
});

describe("composition", () => {
  const pos = (symbol: string, sector: string | null, value: number) => ({ symbol, sector, value }) as never;
  it("flows from portfolios through sectors to holdings, folding small ones", () => {
    const flow = composition(
      {
        positions: [pos("A", "Tech", 600), pos("B", "Tech", 300), pos("C", null, 90), pos("D", "Tech", 10)],
        portfolios: [
          { id: 1, name: "PEA", currency: "EUR" },
          { id: 2, name: "CTO", currency: "EUR" },
        ],
        byPortfolio: [
          { portfolio: 1, symbol: "A", value: 600 },
          { portfolio: 2, symbol: "B", value: 300 },
          { portfolio: 2, symbol: "C", value: 90 },
          { portfolio: 2, symbol: "D", value: 10 },
        ],
      },
      { unclassified: "Unclassified", other: "Other" },
    );
    expect(flow.nodes.map((n) => [n.layer, n.name, n.value])).toEqual([
      [0, "PEA", 600],
      [0, "CTO", 400],
      [1, "Tech", 910],
      [1, "Unclassified", 90],
      [2, "A", 600],
      [2, "B", 300],
      [2, "Other", 10],
      [2, "C", 90],
    ]);
    expect(flow.links.find((l) => l.source === "p:2" && l.target === "s:Tech")?.value).toBe(310);
  });

  it("lays any number of columns out with one scale", () => {
    const { nodes, links } = layoutLayers(
      [
        { id: "a", name: "a", layer: 0, value: 100, color: "x" },
        { id: "b", name: "b", layer: 1, value: 60, color: "x" },
        { id: "c", name: "c", layer: 1, value: 40, color: "x" },
        { id: "d", name: "d", layer: 2, value: 60, color: "x" },
      ],
      [
        { source: "a", target: "b", value: 60, color: "x" },
        { source: "a", target: "c", value: 40, color: "x" },
        { source: "b", target: "d", value: 60, color: "x" },
      ],
      { width: 300, height: 108, gap: 8 },
    );
    const by = (id: string) => nodes.find((n) => n.id === id)!;
    expect(by("a").h).toBeCloseTo(100);
    expect(by("b").h + by("c").h).toBeCloseTo(100);
    expect(by("d").h).toBeCloseTo(by("b").h);
    expect([by("a").x, by("b").x, by("d").x]).toEqual([0, 145, 290]);
    expect(links).toHaveLength(3);
  });
});
