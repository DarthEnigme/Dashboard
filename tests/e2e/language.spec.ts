import { expect, test } from "@playwright/test";
import { readConfig, setSetting, shot, writeConfig } from "./helpers";

test.describe.serial("language", () => {
  let original = "";
  test.beforeAll(() => {
    original = readConfig("settings");
  });
  test.afterAll(() => writeConfig("settings", original));

  test("French everywhere when language is fr", async ({ page }) => {
    setSetting("language", "fr");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByPlaceholder("Filtrer les services…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Modifier le tableau de bord" })).toBeVisible();
    await shot(page, "90-fr-dashboard", { fullPage: false });

    await page.goto("/settings#appearance");
    await expect(page.getByRole("heading", { name: "Apparence", level: 2 })).toBeVisible();
    await expect(page.getByText("Halo au survol")).toBeVisible();
    await shot(page, "91-fr-settings", { fullPage: false });

    await page.goto("/finance");
    await expect(page.getByText("Dépensé", { exact: true }).first()).toBeVisible();
    // Numbers and money follow the language too.
    await expect(page.locator("main")).toContainText("€");
    expect(await page.locator("main").innerText()).toMatch(/\d\s?\d{3}(,\d{2})?\s€|\d+,\d{2}\s€/);
    await shot(page, "92-fr-finance", { fullPage: false });
  });

  test("auto follows the browser", async ({ browser }) => {
    setSetting("language", "auto");
    const fr = await browser.newContext({ locale: "fr-FR", storageState: "test-results/.auth/admin.json" });
    const p = await fr.newPage();
    await p.goto("http://localhost:3300/");
    await expect(p.locator("html")).toHaveAttribute("lang", "fr");
    await expect(p.getByPlaceholder("Filtrer les services…")).toBeVisible();
    await fr.close();
    const en = await browser.newContext({ locale: "en-US", storageState: "test-results/.auth/admin.json" });
    const q = await en.newPage();
    await q.goto("http://localhost:3300/");
    await expect(q.locator("html")).toHaveAttribute("lang", "en");
    await expect(q.getByPlaceholder("Filter services…")).toBeVisible();
    await en.close();
  });
});
