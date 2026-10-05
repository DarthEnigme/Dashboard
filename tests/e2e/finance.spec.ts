import path from "node:path";
import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test.describe.serial("finance tracker", () => {
  test("syncs from Firefly III", async ({ page }) => {
    await page.goto("/finance");
    await page.getByRole("tab", { name: "import" }).click();
    // The daily background sync may already have run since the server started, so the first
    // manual sync reports either 4 or 0 new; either way all 4 end up imported exactly once.
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByRole("status")).toContainText(/Firefly III: (4 new|0 new, 4 already imported)/);
    // Transfers are skipped; syncing again adds nothing.
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByRole("status")).toContainText("0 new, 4 already imported");
  });

  test("imports a French bank CSV, skipping duplicates on a second import", async ({ page }) => {
    const csv = path.join(__dirname, "..", "fixtures", "bank.csv");
    for (const expected of ["Imported 5 transactions, 1 unreadable lines skipped", "Imported 0 transactions, 5 already there"]) {
      await page.goto("/finance");
      await page.getByRole("tab", { name: "import" }).click();
      await page.locator('input[type="file"]').setInputFiles(csv);
      // Columns are guessed from the French headers; amounts use a decimal comma.
      await page.getByLabel("Decimal separator").selectOption(",");
      await page.getByRole("button", { name: "Preview" }).click();
      await expect(page.getByText("5 transactions found; 1 lines can't be read")).toBeVisible();
      if (expected.startsWith("Imported 5")) await shot(page, "51-finance-import");
      await page.getByRole("button", { name: /^Import 5 transactions/ }).click();
      await expect(page.getByRole("status")).toContainText(expected);
    }
  });

  test("adds a transaction by hand and shows the overview charts", async ({ page }) => {
    await page.goto("/finance");
    await page.getByLabel("Description").fill("Concert tickets");
    await page.getByLabel("Category", { exact: true }).fill("Hobbies");
    await page.getByLabel(/Amount in EUR/).fill("85");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByLabel("Description")).toHaveValue("");
    await expect(page.getByRole("img", { name: "Spending by category" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Income and spending per month" })).toBeVisible();
    await shot(page, "50-finance-overview");

    await page.getByRole("tab", { name: "transactions" }).click();
    await expect(page.getByRole("cell", { name: /Concert tickets/ })).toBeVisible();
    await page.getByRole("tab", { name: "categories" }).click();
    await page.getByRole("radiogroup", { name: "Colour for Hobbies" }).getByRole("radio", { name: "Colour 7" }).click();
    await expect(page.getByRole("radiogroup", { name: "Colour for Hobbies" }).getByRole("radio", { name: "Colour 7" })).toHaveAttribute("aria-checked", "true");
    await shot(page, "52-finance-categories");
  });

  test("budgets and the money-flow chart", async ({ page }) => {
    await page.goto("/finance");
    await page.getByRole("tab", { name: "categories" }).click();
    const budget = page.getByLabel("Monthly budget for Hobbies (EUR)");
    await budget.fill("50");
    await budget.press("Enter");
    await expect(budget).toHaveValue("50");

    await page.getByRole("tab", { name: "overview" }).click();
    const meter = page.getByRole("meter", { name: "Hobbies budget used" });
    await expect(meter).toHaveAttribute("aria-valuetext", /over budget/);
    await expect(page.getByRole("img", { name: "Where the money came from and where it went" })).toBeVisible();

    await page.getByRole("tab", { name: "flow" }).click();
    const flow = page.getByRole("img", { name: "Where the money came from and where it went" });
    await expect(flow).toBeVisible();
    await expect(page.getByRole("cell", { name: "Saved", exact: true }).or(page.getByRole("cell", { name: "From savings", exact: true }))).toHaveCount(1);
    await flow.locator("path").first().hover();
    await expect(page.getByRole("tooltip")).toContainText(/% of (income|spending)/);
    await shot(page, "54-finance-flow");

    // Budgets survive a reload (stored server-side).
    await page.reload();
    await page.getByRole("tab", { name: "categories" }).click();
    await expect(page.getByLabel("Monthly budget for Hobbies (EUR)")).toHaveValue("50");
  });

  test("the finance tile shows on the dashboard for signed-in users only", async ({ page, browser }) => {
    await page.goto("/");
    const tile = page.getByRole("img", { name: "Spending by category" });
    await tile.scrollIntoViewIfNeeded();
    await expect(tile).toBeVisible();
    await shot(page, "53-finance-tile");

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await anon.newPage();
    await p.goto("http://localhost:3300/");
    await expect(p.getByText("Budget", { exact: true })).toBeHidden();
    expect((await p.request.get("http://localhost:3300/api/finance/summary")).status()).toBe(401);
    expect((await p.request.get("http://localhost:3300/api/widget/home.budget")).status()).toBe(404);
    await anon.close();
  });
});
