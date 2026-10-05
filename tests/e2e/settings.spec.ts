import { expect, test } from "@playwright/test";
import { readConfig, setSetting, shot } from "./helpers";

test.describe.serial("settings page", () => {
  test.afterAll(() => setSetting("style", "glass"));

  test("opens from the dashboard and previews the style before saving", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Appearance" }).click();
    await expect(page).toHaveURL(/#appearance$/);
    await page.getByText("Liquid glass", { exact: true }).click();
    // Previewed immediately, not yet written.
    await expect(page.locator('html[data-style="liquid"]')).toBeAttached();
    expect(readConfig("settings")).toMatch(/^style: glass$/m);
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toContainText("1 unsaved change");
    await shot(page, "60-settings-appearance", { fullPage: false });

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Settings saved");
    expect(readConfig("settings")).toMatch(/^style: liquid$/m);
    // Comments in the file survive the save.
    expect(readConfig("settings")).toContain("# e2e fixture");

    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.locator('html[data-style="liquid"]')).toBeAttached();
  });

  test("a look sets style, background, accent and glow together", async ({ page }) => {
    await page.goto("/settings#appearance");
    await page.getByRole("button", { name: "Frutiger Aero" }).click();
    await expect(page.locator('html[data-style="aero"][data-glow="subtle"]')).toBeAttached();
    await expect(page.locator(".bg-aero")).toBeAttached();
    await expect(page.getByRole("button", { name: "Frutiger Aero" })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "62-settings-look-aero", { fullPage: false });
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.locator('html[data-style="aero"]')).toHaveCount(0);
  });

  test("validates before saving and can discard", async ({ page }) => {
    await page.goto("/settings#refresh");
    const field = page.getByLabel("Widget refresh (seconds)");
    await field.fill("2");
    await expect(page.getByText(/greater than or equal to 5/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toContainText("1 problem to fix");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(field).toHaveValue("10");
    await expect(page.getByRole("region", { name: "Unsaved changes" })).toHaveCount(0);
  });

  test("search finds settings across sections", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("textbox", { name: "Search settings" }).fill("webhook");
    await expect(page.getByLabel("Discord webhook URL")).toBeVisible();
    await expect(page.getByLabel("Generic webhook URL")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveCount(0);
    await shot(page, "61-settings-search", { fullPage: false });
  });

  test("exports the config files as a zip", async ({ page }) => {
    const res = await page.request.get("/api/config/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/zip");
    const body = await res.body();
    expect(body.subarray(0, 2).toString()).toBe("PK");
    expect(body.includes(Buffer.from("settings.yaml"))).toBe(true);
  });
});
