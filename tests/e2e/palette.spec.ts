import { expect, test, type Page } from "@playwright/test";
import { readConfig, setSetting, shot } from "./helpers";

/** Ctrl+K, retried until the page has hydrated and the palette shows. */
async function openPalette(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  return dialog;
}

test.describe.serial("command palette", () => {
  test.afterAll(() => setSetting("theme", "dark"));

  test("opens with Ctrl+K and jumps to a tab, a service page and a settings section", async ({ page }) => {
    await page.goto("/");
    const dialog = await openPalette(page);
    const box = dialog.getByRole("combobox", { name: "Command" });
    await expect(box).toBeFocused();
    await shot(page, "70-palette", { fullPage: false });

    await box.fill("netwrk");
    await expect(dialog.getByRole("option").first()).toContainText("Network");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/network$/);
    await expect(dialog).toBeHidden();

    await openPalette(page);
    await box.fill("proxmox");
    await expect(dialog.getByRole("option", { selected: true })).toContainText("Proxmox");
    await box.press("Shift+Enter");
    await expect(page).toHaveURL(/\/service\/infra\.proxmox$/);

    // Works on other pages too, and remembers recent picks.
    await openPalette(page);
    await expect(dialog.getByText("Recent", { exact: true })).toBeVisible();
    await box.fill("settings refresh");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/settings#refresh$/);
  });

  test("Esc closes and the header button opens it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open command palette" }).click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("admins run a container action with a confirm step", async ({ page }) => {
    await page.goto("/");
    const dialog = await openPalette(page);
    const box = dialog.getByRole("combobox", { name: "Command" });
    await box.fill("actions dockhand");
    await box.press("Enter");
    await expect(dialog.getByRole("option", { name: /Restart jellyfin/ })).toBeVisible();
    await box.fill("restart jelly");
    await box.press("Enter");
    await expect(dialog.getByText("Restart jellyfin?")).toBeVisible();
    await box.press("Enter");
    await expect(dialog.getByRole("status")).toContainText("jellyfin: restarted");
  });

  test("switches the theme and opens the editor", async ({ page }) => {
    await page.goto("/finance");
    await openPalette(page);
    const box = page.getByRole("combobox", { name: "Command" });
    await box.fill("theme light");
    await box.press("Enter");
    await expect(page.locator('html[data-theme="light"]')).toBeAttached();
    expect(readConfig("settings")).toMatch(/^theme: light$/m);
    expect(readConfig("settings")).toContain("# e2e fixture"); // comments kept

    await openPalette(page);
    await box.fill("edit dashboard");
    await box.press("Enter");
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
  });
});
