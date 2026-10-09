import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SHOTS_DIR, shot } from "./helpers";

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

  test("exports the money flow as PNG, SVG, CSV and a PDF report", async ({ page, context }) => {
    await page.goto("/finance");
    await page.getByRole("tab", { name: "flow" }).click();
    await expect(page.getByRole("img", { name: "Where the money came from and where it went" })).toBeVisible();
    const month = new Date().toISOString().slice(0, 7);
    const exportAs = async (label: string) => {
      await page.getByRole("button", { name: "Export" }).click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: label }).click()]);
      return download;
    };

    const png = await exportAs("Image (PNG)");
    expect(png.suggestedFilename()).toBe(`money-flow-${month}.png`);
    const pngBytes = fs.readFileSync((await png.path())!);
    expect(pngBytes.subarray(1, 4).toString()).toBe("PNG");
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOTS_DIR, "56-finance-flow-export.png"), pngBytes);
    // The corners are see-through.
    const cornerAlpha = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, 1, 1).data[3];
    }, pngBytes.toString("base64"));
    expect(cornerAlpha).toBe(0);

    const svg = await exportAs("Vector (SVG)");
    const markup = fs.readFileSync((await svg.path())!, "utf8");
    expect(markup).toContain("<svg");
    expect(markup).toContain("Hobbies");
    // Colours are resolved: nothing that only means something inside the page.
    expect(markup).not.toMatch(/var\(--|class="/);
    // Just the flow: no background behind it.
    expect(markup).not.toMatch(/<svg[^>]*>\s*<rect/);

    const csv = await exportAs("Flows (CSV)");
    const text = fs.readFileSync((await csv.path())!, "utf8");
    expect(text.split("\r\n")[0]).toBe("source,target,amount,currency,share_percent");
    expect(text).toMatch(/Budget,Hobbies,\d+\.\d\d,EUR,/);

    await page.getByRole("button", { name: "Export" }).click();
    const [report] = await Promise.all([context.waitForEvent("page"), page.getByRole("menuitem", { name: "Report (PDF)" }).click()]);
    // Stop the print dialog: headless Chromium has none, but the report must not depend on it.
    await report.waitForLoadState();
    expect(report.url()).toContain(`/finance/report?period=${month}`);
    await expect(report.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(report.getByRole("img", { name: "Where the money came from and where it went" })).toBeVisible();
    await report.emulateMedia({ media: "print" });
    await shot(report, "55-finance-report-print");
    const pdf = await report.pdf({ format: "A4", printBackground: true });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    await report.close();
  });

  test("accounts: balances, a transfer, and filtering by account", async ({ page }) => {
    await page.goto("/finance");
    await page.getByRole("tab", { name: "accounts" }).click();
    // Firefly III's account came in with its transactions.
    await expect(page.locator('[data-account="Checking"]')).toBeVisible();
    for (const [name, opening] of [["Wallet", "1000"], ["Holiday fund", "0"]]) {
      await page.getByRole("button", { name: "Add account" }).click();
      await page.getByLabel("Name").fill(name);
      await page.getByLabel("Opening balance").fill(opening);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.locator(`[data-account="${name}"]`)).toBeVisible();
    }
    await expect(page.getByLabel("Wallet balance", { exact: true })).toHaveText(/^€1,000(\.00)?$/);

    await page.getByRole("button", { name: "Transfer" }).click();
    await page.getByLabel("From").selectOption("Wallet");
    await page.getByLabel("To").selectOption("Holiday fund");
    await page.getByRole("spinbutton", { name: /^Amount \(EUR\)/ }).fill("250");
    await page.getByRole("button", { name: "Transfer", exact: true }).last().click();
    await expect(page.getByLabel("Wallet balance", { exact: true })).toHaveText(/^€750(\.00)?$/);
    await expect(page.getByLabel("Holiday fund balance", { exact: true })).toHaveText(/^€250(\.00)?$/);
    await shot(page, "57-finance-accounts");

    // An expense added while viewing Wallet lands in Wallet; the transfer isn't spending.
    const spentBefore = await page.locator(".glass", { hasText: "Spent" }).first().innerText();
    await page.getByRole("combobox", { name: "Account" }).first().selectOption("Wallet");
    await page.getByLabel("Description").fill("Bike repair");
    await page.getByLabel(/Amount in EUR/).fill("40");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByLabel("Wallet balance", { exact: true })).toHaveText(/^€710(\.00)?$/);
    await page.getByRole("tab", { name: "transactions" }).click();
    await expect(page.getByRole("cell", { name: "Bike repair" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Transfer to Holiday fund" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Salary" })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Account" }).first().selectOption("*");
    expect(spentBefore).toContain("Spent");
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
