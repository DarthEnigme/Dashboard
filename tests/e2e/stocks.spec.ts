import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test.describe.serial("stocks", () => {
  test("record trades and see the portfolio", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Apps" }).click();
    await page.getByRole("menuitem", { name: "Stocks" }).click();
    await expect(page).toHaveURL(/\/stocks$/);
    await expect(page.getByRole("heading", { name: "Stocks", level: 1 })).toBeVisible();

    const trade = async (search: string, option: RegExp, fields: Record<string, string>, sell = false) => {
      await page.getByRole("button", { name: "New transaction" }).click();
      const dialog = page.getByRole("dialog", { name: "New transaction" });
      await dialog.getByRole("combobox", { name: "Search a share, fund or index" }).fill(search);
      await dialog.getByRole("option", { name: option }).click();
      if (sell) await dialog.getByRole("button", { name: "Sell", exact: true }).click();
      for (const [label, value] of Object.entries(fields)) await dialog.getByLabel(label).fill(value);
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toHaveCount(0);
    };
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    await trade("lvmh", /MC\.PA/, { Date: yearAgo, Shares: "10", "Price per share (in the share's currency)": "500", "Fees (optional)": "5" });
    await trade("apple", /AAPL/, { Date: yearAgo, Shares: "20", "Price per share (in the share's currency)": "150" });
    await trade("apple", /AAPL/, { Date: monthAgo, Shares: "5", "Price per share (in the share's currency)": "260" }, true);

    // Holdings: both lines, the foreign one converted, with a gain.
    const holdings = page.getByRole("table");
    await expect(holdings.getByRole("row")).toHaveCount(3);
    await expect(holdings.getByRole("row", { name: /MC\.PA/ })).toContainText("10");
    await expect(holdings.getByRole("row", { name: /AAPL/ })).toContainText("15");
    await expect(page.getByRole("region", { name: "Portfolio figures" })).toContainText("€");
    await expect(page.getByRole("img", { name: "Portfolio value and money invested over time" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Portfolio allocation" })).toBeVisible();
    await page.getByRole("button", { name: "Performance", exact: true }).click();
    await expect(page.getByRole("img", { name: "Portfolio return compared with S&P 500" })).toBeVisible();
    await page.getByRole("button", { name: "Value", exact: true }).click();
    await shot(page, "97-stocks-portfolio");

    // The figures the page is built from.
    const data = await (await page.request.get("/api/stocks")).json();
    expect(data.errors).toEqual([]);
    expect(data.positions.map((p: { symbol: string }) => p.symbol).sort()).toEqual(["AAPL", "MC.PA"]);
    const lvmh = data.positions.find((p: { symbol: string }) => p.symbol === "MC.PA");
    expect(lvmh.avgCost).toBeCloseTo(500.5);
    expect(lvmh.gain).toBeGreaterThan(0);
    // 5 shares bought at 150 dollars and sold at 260, at 0.9 euro a dollar.
    expect(data.realized).toBeCloseTo(495, 0);
    expect(data.dividends).toBeGreaterThan(0);

    await page.getByRole("tab", { name: "Transactions" }).click();
    await expect(page.getByRole("row")).toHaveCount(4);
    await page.getByRole("tab", { name: "Dividends" }).click();
    await expect(page.getByRole("img", { name: "Dividends received per year" })).toBeVisible();

    // A symbol Yahoo doesn't know is refused.
    await page.getByRole("button", { name: "New transaction" }).click();
    const refused = await page.request.post("/api/stocks/transactions", { data: { portfolio: data.portfolios[0].id, symbol: "NOPE", kind: "buy", date: yearAgo, quantity: 1, price: 1 } });
    expect(refused.status()).toBe(400);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  });

  test("look a company up, watch it, and start a trade from its page", async ({ page }) => {
    await page.goto("/stocks");
    await page.getByRole("combobox", { name: "Look up a company, fund or index" }).fill("lvmh");
    await page.getByRole("option", { name: /MC\.PA/ }).click();
    await expect(page).toHaveURL(/\/stocks\/MC\.PA$/);
    await expect(page.getByRole("heading", { name: "LVMH Moët Hennessy", level: 1 })).toBeVisible();
    await expect(page.getByText("MC.PA · Paris · Consumer Cyclical · Luxury Goods")).toBeVisible();
    await expect(page.getByRole("img", { name: /^Price of LVMH/ })).toBeVisible();
    await expect(page.getByText("Price / earnings")).toBeVisible();
    await expect(page.getByText("21.5")).toBeVisible();
    for (const chart of ["Revenue", "Net income", "Earnings per share", "Free cash flow", "Margins", "Cash and debt", "Dividend per share"]) await expect(page.getByRole("img", { name: chart, exact: true })).toBeVisible();
    // What is held of it shows on its page.
    await expect(page.getByRole("region", { name: "Your position" })).toContainText("10");
    await page.getByRole("button", { name: "5Y", exact: true }).click();
    await expect(page.getByRole("button", { name: "5Y", exact: true })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "97-stocks-research");

    await page.getByRole("button", { name: "Watch", exact: true }).click();
    await expect(page.getByRole("button", { name: "Watching" })).toBeVisible();

    await page.getByRole("link", { name: "New transaction" }).click();
    await expect(page.getByRole("dialog", { name: "New transaction" })).toContainText("MC.PA");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/stocks$/);

    await page.getByRole("tab", { name: "Watched" }).click();
    await expect(page.getByRole("link", { name: /MC\.PA/ })).toBeVisible();
    await page.getByRole("button", { name: "Stop watching MC.PA" }).click();
    await page.getByRole("button", { name: /^Confirm/ }).click();
    await expect(page.getByText("Nothing watched yet.")).toBeVisible();

    // An index has a price but no company figures.
    await page.goto("/stocks/%5EGSPC");
    await expect(page.getByRole("heading", { name: "S&P 500", level: 1 })).toBeVisible();
    await expect(page.getByText("No company figures for this one")).toBeVisible();
  });
});
