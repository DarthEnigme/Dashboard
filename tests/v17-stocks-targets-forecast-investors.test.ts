import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { forget } from "@/lib/cache";
import { localDay } from "@/lib/day";
import { forecastDividends } from "@/lib/stocks/forecast";
import { rebalance } from "@/lib/stocks/rebalance";
import { listTargets, setTargets } from "@/lib/stocks/targets";
import { addTransaction, deletePortfolio, ensurePortfolios, addPortfolio, listPortfolios } from "@/lib/stocks/store";
import { loadStocks, loadTargets } from "@/lib/stocks/service";
import { compareQuarters, loadInvestor } from "@/lib/stocks/investors";
import { parseInfoTable, parseSubmissions } from "@/lib/stocks/investors/sec";
import { sanitize } from "@/lib/config/sanitize";
import { loadConfig } from "@/lib/config/load";
import * as yahoo from "@/lib/stocks/yahoo";
import type { History } from "@/lib/stocks/yahoo";

const user = (name: string) => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, 'user', ?)").run(name, Date.now()).lastInsertRowid);
let me = 0;
beforeEach(() => {
  db().exec("DELETE FROM stock_portfolios; DELETE FROM stock_targets; DELETE FROM stock_cache; DELETE FROM users;");
  forget("stocks:");
  me = user("me");
});
afterEach(() => vi.restoreAllMocks());

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

describe("rebalancing", () => {
  const holdings = [
    { symbol: "AAA", name: "A", value: 6000, price: 100 },
    { symbol: "BBB", name: "B", value: 2000, price: 50 },
    { symbol: "OLD", name: "Old", value: 2000, price: 10 },
  ];
  const targets = [
    { symbol: "AAA", weight: 40 },
    { symbol: "BBB", weight: 30 },
    { symbol: "NEW", weight: 10 },
  ];

  it("says what to buy and sell to reach the targets, leaving untargeted holdings alone", () => {
    const r = rebalance(holdings, targets, 0, false);
    expect(r.total).toBe(10_000);
    const row = (s: string) => r.rows.find((x) => x.symbol === s)!;
    expect(row("AAA")).toMatchObject({ weight: 60, target: 40, targetValue: 4000, trade: -2000, shares: -20 });
    expect(row("BBB")).toMatchObject({ trade: 1000, shares: 20 });
    expect(row("NEW")).toMatchObject({ value: 0, trade: 1000, shares: null });
    expect(row("OLD")).toMatchObject({ target: null, trade: 0 });
    expect(r.unallocated).toBe(20);
    expect(r.cashLeft).toBeCloseTo(0);
  });

  it("only buys, sharing the cash by how far under target each one is", () => {
    // 2,000 added: total 12,000. Under target: BBB by 1,600, NEW by 1,200 (AAA is over).
    const r = rebalance(holdings, targets, 2000, true);
    const trade = (s: string) => r.rows.find((x) => x.symbol === s)!.trade;
    expect(trade("AAA")).toBe(0);
    expect(trade("BBB")).toBeCloseTo((1600 / 2800) * 2000);
    expect(trade("NEW")).toBeCloseTo((1200 / 2800) * 2000);
    expect(r.cashLeft).toBeCloseTo(0);
    // Enough cash: each gets to its target, the rest stays.
    const rich = rebalance(holdings, targets, 100_000, true);
    expect(rich.rows.find((x) => x.symbol === "BBB")!.targetValue).toBeCloseTo(rich.rows.find((x) => x.symbol === "BBB")!.value + rich.rows.find((x) => x.symbol === "BBB")!.trade);
    expect(rich.cashLeft).toBeGreaterThan(0);
  });

  it("keeps targets per portfolio, checked, and drops them with the portfolio", () => {
    const [main] = ensurePortfolios(me, "Main", "EUR");
    addPortfolio(me, { name: "PEA", currency: "EUR" });
    const pea = listPortfolios(me)[1];
    setTargets(me, { portfolio: pea.id, targets: [{ symbol: "aapl", weight: 30 }, { symbol: "MC.PA", weight: 50 }] });
    setTargets(me, { portfolio: null, targets: [{ symbol: "VT", weight: 100 }] });
    expect(listTargets(me, pea.id)).toEqual([
      { symbol: "MC.PA", weight: 50 },
      { symbol: "AAPL", weight: 30 },
    ]);
    expect(listTargets(me, null)).toEqual([{ symbol: "VT", weight: 100 }]);
    expect(listTargets(me, main.id)).toEqual([]);
    expect(() => setTargets(me, { portfolio: pea.id, targets: [{ symbol: "A", weight: 60 }, { symbol: "B", weight: 50 }] })).toThrow(/more than 100/);
    expect(() => setTargets(me, { portfolio: pea.id, targets: [{ symbol: "A", weight: 10 }, { symbol: "a", weight: 10 }] })).toThrow(/once/);
    expect(() => setTargets(me, { portfolio: 999_999, targets: [] })).toThrow(/No such portfolio/);
    // Refused changes leave the targets as they were.
    expect(listTargets(me, pea.id)).toHaveLength(2);
    deletePortfolio(me, pea.id);
    expect(db().prepare("SELECT COUNT(*) AS n FROM stock_targets WHERE portfolio_id = ?").get(pea.id)).toEqual({ n: 0 });
  });

  it("prices targets not held yet, in the portfolio's currency", async () => {
    vi.spyOn(yahoo, "searchSymbols").mockResolvedValue([]);
    vi.spyOn(yahoo, "fetchHistory").mockImplementation(async (s) => (s === "USDEUR=X" ? history(s, "EUR", 0.9) : s === "AAPL" ? history("AAPL", "USD", 200) : history(s, "EUR", 50)));
    const [p] = ensurePortfolios(me, "Main", "EUR");
    addTransaction(me, { portfolio: p.id, symbol: "MC.PA", kind: "buy", date: "2026-01-02", quantity: 10, price: 40 }, "EUR");
    setTargets(me, { portfolio: p.id, targets: [{ symbol: "MC.PA", weight: 50 }, { symbol: "AAPL", weight: 50 }] });
    const d = await loadTargets(me, listPortfolios(me), p.id);
    expect(d).toMatchObject({ currency: "EUR", value: 500, targets: [{ symbol: "AAPL" }, { symbol: "MC.PA" }] });
    expect(d.holdings).toEqual([
      { symbol: "MC.PA", name: "MC.PA Inc", value: 500, price: 50 },
      { symbol: "AAPL", name: "AAPL Inc", value: 0, price: 180 },
    ]);
  });
});

describe("dividend forecast", () => {
  const fx = (c: string) => (c === "USD" ? 0.9 : 1);
  it("expects last year's dividends again a year later, on the shares held now", () => {
    const markets = new Map([
      ["KO", { currency: "USD", dividends: [{ day: "2025-06-13", amount: 0.5 }, { day: "2026-03-14", amount: 0.51 }, { day: "2026-06-13", amount: 0.51 }] }],
      ["MC.PA", { currency: "EUR", dividends: [{ day: "2026-04-24", amount: 7.5 }] }],
    ]);
    const f = forecastDividends(
      [
        { symbol: "KO", quantity: 100 },
        { symbol: "MC.PA", quantity: 2 },
        { symbol: "GONE", quantity: 5 },
      ],
      markets,
      fx,
      "2026-11-13",
    );
    expect(f.payments.map((p) => [p.day, p.symbol])).toEqual([
      ["2027-03-14", "KO"],
      ["2027-04-24", "MC.PA"],
      ["2027-06-13", "KO"],
    ]);
    expect(f.payments[0].amount).toBeCloseTo(0.51 * 100 * 0.9);
    expect(f.total).toBeCloseTo(0.51 * 100 * 0.9 * 2 + 15);
    expect(f.months).toHaveLength(12);
    expect(f.months[0].month).toBe("2026-11");
    expect(f.months.find((m) => m.month === "2027-04")!.amount).toBeCloseTo(15);
  });

  it("is on the portfolio page", async () => {
    const today = localDay();
    const lastQuarter = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    vi.spyOn(yahoo, "searchSymbols").mockResolvedValue([]);
    vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("KO", "EUR", 60, { days: ["2024-01-02", today], closes: [50, 60], dividends: [{ day: lastQuarter, amount: 1 }] }));
    const [p] = ensurePortfolios(me, "Main", "EUR");
    addTransaction(me, { portfolio: p.id, symbol: "KO", kind: "buy", date: "2024-01-02", quantity: 10, price: 50 }, "EUR");
    const data = await loadStocks(me, listPortfolios(me), p.id, undefined);
    expect(data.forecast.total).toBeCloseTo(10);
    expect(data.forecast.payments).toHaveLength(1);
  });
});

// A real (trimmed) 13F holdings table: the same security filed twice, once per manager.
const TABLE = `<?xml version="1.0" encoding="UTF-8"?>
<ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <ns1:infoTable><ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>037833100</ns1:cusip><ns1:value>60000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>300000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt></ns1:infoTable>
  <ns1:infoTable><ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>037833100</ns1:cusip><ns1:value>20000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>100000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt></ns1:infoTable>
  <ns1:infoTable><ns1:nameOfIssuer>BANK AMER CORP</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>060505104</ns1:cusip><ns1:value>15000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>350000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt></ns1:infoTable>
  <ns1:infoTable><ns1:nameOfIssuer>SPDR S&amp;P 500 ETF TR</ns1:nameOfIssuer><ns1:titleOfClass>TR UNIT</ns1:titleOfClass><ns1:cusip>78462F103</ns1:cusip><ns1:value>5000000</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>8000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt><ns1:putCall>Put</ns1:putCall></ns1:infoTable>
</ns1:informationTable>`;
const BEFORE = `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>70000000</value><shrsOrPrnAmt><sshPrnamt>500000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
  <infoTable><nameOfIssuer>KRAFT HEINZ CO</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>500754106</cusip><value>9000000</value><shrsOrPrnAmt><sshPrnamt>300000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
</informationTable>`;

describe("13F reports", () => {
  it("reads a filer's 13F reports, latest first, amendments left out", () => {
    const f = parseSubmissions({
      name: "BERKSHIRE HATHAWAY INC",
      filings: {
        recent: {
          accessionNumber: ["a-1", "a-2", "a-3", "a-4"],
          form: ["10-Q", "13F-HR", "13F-HR/A", "13F-HR"],
          filingDate: ["2026-11-01", "2026-05-15", "2026-06-01", "2026-08-14"],
          reportDate: ["", "2026-03-31", "2026-03-31", "2026-06-30"],
        },
      },
    });
    expect(f).toEqual({
      name: "BERKSHIRE HATHAWAY INC",
      filings: [
        { accession: "a-4", filed: "2026-08-14", period: "2026-06-30" },
        { accession: "a-2", filed: "2026-05-15", period: "2026-03-31" },
      ],
    });
  });

  it("reads a holdings table, adding up a security filed several times, in dollars", () => {
    const rows = parseInfoTable(TABLE, "2026-08-14");
    expect(rows.map((r) => [r.issuer, r.value, r.shares, r.putCall])).toEqual([
      ["APPLE INC", 80_000_000, 400_000, null],
      ["BANK AMER CORP", 15_000_000, 350_000, null],
      ["SPDR S&P 500 ETF TR", 5_000_000, 8000, "Put"],
    ]);
    // Before 2023, values were filed in thousands.
    expect(parseInfoTable(BEFORE, "2022-11-14")[0].value).toBe(70_000_000_000);
  });

  it("tells new, added, reduced and sold holdings apart", () => {
    const { total, holdings, sold } = compareQuarters(parseInfoTable(TABLE, "2026-08-14"), parseInfoTable(BEFORE, "2026-05-15"));
    expect(total).toBe(100_000_000);
    expect(holdings.map((h) => [h.issuer, h.change, h.weight])).toEqual([
      ["APPLE INC", "reduced", 80],
      ["BANK AMER CORP", "new", 15],
      ["SPDR S&P 500 ETF TR", "new", 5],
    ]);
    expect(holdings[0].sharesChange).toBeCloseTo(-20);
    expect(sold).toEqual([{ issuer: "KRAFT HEINZ CO", title: "COM", value: 9_000_000, putCall: null }]);
  });

  describe("from the SEC", () => {
    let server: http.Server;
    const agents: string[] = [];
    beforeAll(async () => {
      server = http.createServer((req, res) => {
        agents.push(req.headers["user-agent"] ?? "");
        const url = req.url ?? "";
        const json = (b: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(b));
        if (url === "/data/submissions/CIK0001067983.json")
          return json({ name: "BERKSHIRE HATHAWAY INC", filings: { recent: { accessionNumber: ["0001-26-2", "0001-26-1"], form: ["13F-HR", "13F-HR"], filingDate: ["2026-08-14", "2026-05-15"], reportDate: ["2026-06-30", "2026-03-31"] } } });
        if (url === "/Archives/edgar/data/1067983/0001262/index.json") return json({ directory: { item: [{ name: "primary_doc.xml" }, { name: "56757.xml" }] } });
        if (url === "/Archives/edgar/data/1067983/0001261/index.json") return json({ directory: { item: [{ name: "primary_doc.xml" }, { name: "old.xml" }] } });
        if (url.endsWith("/56757.xml")) return res.writeHead(200).end(TABLE);
        if (url.endsWith("/old.xml")) return res.writeHead(200).end(BEFORE);
        res.writeHead(404).end();
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      Object.assign(process.env, { PAGE_SEC_URL: base, PAGE_SEC_DATA_URL: `${base}/data` });
    });
    afterAll(() => {
      server.close();
      delete process.env.PAGE_SEC_CONTACT;
    });

    it("asks for the contact e-mail the SEC wants, and never shows it to the browser", async () => {
      delete process.env.PAGE_SEC_CONTACT;
      await expect(loadInvestor(me, 1067983)).rejects.toThrow(/contact e-mail/);
      expect(agents).toEqual([]);
      const client = sanitize({ ...loadConfig(), settings: { ...loadConfig().settings, stocks: { ...loadConfig().settings.stocks, secContact: "me@example.com" } } });
      expect(JSON.stringify(client)).not.toContain("me@example.com");
    });

    it("compares the last two reports, matches symbols by CUSIP and marks what you hold", async () => {
      process.env.PAGE_SEC_CONTACT = "admin@example.com";
      vi.spyOn(yahoo, "searchSymbols").mockImplementation(async (q) =>
        q === "037833100" ? [{ symbol: "AAPL", name: "Apple", exchange: "NASDAQ", type: "EQUITY", sector: null, industry: null }] : q === "BANK AMER CORP" ? [{ symbol: "BAC.MX", name: "Bank of America", exchange: "Mexico", type: "EQUITY", sector: null, industry: null }] : [],
      );
      vi.spyOn(yahoo, "fetchHistory").mockResolvedValue(history("AAPL", "USD", 200));
      const [p] = ensurePortfolios(me, "Main", "USD");
      addTransaction(me, { portfolio: p.id, symbol: "AAPL", kind: "buy", date: "2026-01-02", quantity: 1, price: 150 }, "USD");

      const d = await loadInvestor(me, 1067983);
      expect(d).toMatchObject({ name: "BERKSHIRE HATHAWAY INC", manager: "Warren Buffett", period: "2026-06-30", previousPeriod: "2026-03-31", total: 100_000_000, count: 3 });
      expect(d.holdings.map((h) => [h.issuer, h.symbol, h.held, h.change])).toEqual([
        ["APPLE INC", "AAPL", true, "reduced"],
        // Only a foreign listing found: no symbol rather than the wrong one.
        ["BANK AMER CORP", null, false, "new"],
        // Options are not matched to the shares.
        ["SPDR S&P 500 ETF TR", null, false, "new"],
      ]);
      expect(d.sold.map((s) => s.issuer)).toEqual(["KRAFT HEINZ CO"]);
      expect(agents.every((a) => a.includes("admin@example.com"))).toBe(true);
    });
  });
});
