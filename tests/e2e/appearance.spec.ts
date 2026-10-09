import { expect, test } from "@playwright/test";
import { readConfig, setSetting, shot, writeConfig } from "./helpers";

test.describe.serial("appearance", () => {
  let original = "";
  test.beforeAll(() => {
    original = readConfig("settings");
  });
  test.afterAll(() => writeConfig("settings", original));

  test("dropdown lists use the theme colours", async ({ page }) => {
    await page.goto("/settings#appearance");
    await expect(page.getByRole("heading", { name: "Appearance", level: 2 })).toBeVisible();
    const picker = page.getByLabel("Start from");
    await picker.click();
    await expect(page.getByRole("option", { name: "Nord" })).toBeVisible();
    await page.getByRole("option", { name: "Nord" }).hover();
    await shot(page, "70-dropdown-open", { fullPage: false });
    const checked = await page.getByRole("option", { name: "Dark", exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor);
    // Not the OS grey: the checked option is tinted with the accent.
    expect(checked).not.toMatch(/^rgb\((\d+), \1, \1\)$/);
    await page.keyboard.press("Escape");
  });

  test("custom theme: create, edit, use, save", async ({ page }) => {
    await page.goto("/settings#appearance");
    await page.getByLabel("Start from").selectOption("light");
    await page.getByRole("button", { name: "New theme" }).click();
    const row = page.locator('[data-custom-theme="my-light"]');
    await expect(row).toContainText("In use");
    await expect(page.locator('html[data-palette][data-theme="light"]')).toBeAttached();

    await row.getByLabel("Name").fill("Mint paper");
    // Low contrast text is flagged.
    const text = row.getByLabel("Text", { exact: true });
    await text.fill("#eeeeee");
    await expect(row.getByRole("alert")).toContainText("hard to read");
    await text.fill("#1f3b2d");
    await expect(row.getByRole("alert")).toHaveCount(0);
    await row.getByLabel("Background", { exact: true }).fill("#e8f5ee");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--page").trim())).toBe("#e8f5ee");
    await shot(page, "74-custom-theme-editor", { fullPage: false });

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Settings saved")).toBeVisible();
    const yaml = readConfig("settings");
    expect(yaml).toContain("theme: custom:my-light");
    expect(yaml).toContain("Mint paper");

    await page.goto("/");
    await expect(page.locator('html[data-palette][data-theme="light"]')).toBeAttached();
    await shot(page, "75-custom-theme-dashboard", { fullPage: false });
    writeConfig("settings", original);
  });

  test("hover glow is a slider; 0 turns it off", async ({ page }) => {
    await page.goto("/settings#appearance");
    const slider = page.getByLabel("Hover glow");
    await expect(slider).toHaveValue("50");
    await slider.fill("0");
    await expect(page.locator('html[data-glow="none"]')).toBeAttached();
    await slider.fill("90");
    await expect(page.locator('html[data-glow="strong"]')).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--glow"))).toBe("0.9");
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.locator('html[data-glow="subtle"]')).toBeAttached();
  });

  test("glow saved as a number renders", async ({ page }) => {
    setSetting("glow", "80");
    await page.goto("/");
    await expect(page.locator('html[data-glow="strong"]')).toBeAttached();
    setSetting("glow", "subtle");
  });

  test("background lives in Appearance; #background still works", async ({ page }) => {
    await page.goto("/settings#background");
    await expect(page.getByRole("heading", { name: "Appearance", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Background", level: 3 })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Background", exact: true })).toHaveCount(0);
  });

  test("built-in colour themes: Nord", async ({ page }) => {
    await page.goto("/settings#appearance");
    await page.getByRole("button", { name: "Nord" }).click();
    await expect(page.locator('html[data-palette][data-theme="dark"]')).toBeAttached();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--page").trim())).toBe("#2e3440");
    await shot(page, "71-look-nord", { fullPage: false });
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.locator("html[data-palette]")).toHaveCount(0);
  });

  for (const theme of ["dracula", "catppuccin-latte", "gruvbox", "tokyo-night"]) {
    test(`dashboard in ${theme}`, async ({ page }) => {
      setSetting("theme", theme);
      await page.goto("/");
      await expect(page.locator("html[data-palette]")).toBeAttached();
      await shot(page, `72-theme-${theme}`, { fullPage: false });
    });
  }

  test("new gradients", async ({ page }) => {
    setSetting("theme", "dark");
    setSetting("background", "{ gradient: cyberpunk }");
    await page.goto("/");
    await shot(page, "73-gradient-cyberpunk", { fullPage: false });
    setSetting("background", "{ gradient: aurora }");
  });

});
