import { expect, test } from "@playwright/test";
import path from "node:path";
import { readConfig, shot, writeConfig } from "./helpers";

test.describe.serial("dashboard flows", () => {
  test("tabs switch without reload and have their own URL", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Proxmox", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Tabs" }).getByText("Network").click();
    await expect(page).toHaveURL(/\/network$/);
    await expect(page.getByText("Pi-hole", { exact: true })).toBeVisible();
    await expect(page.getByText("Proxmox", { exact: true })).toBeHidden();
    await page.goBack();
    await expect(page.getByText("Proxmox", { exact: true })).toBeVisible();
  });

  test("filter searches all tabs and labels matches", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("textbox", { name: "Filter services and bookmarks" });
    // The shortcut is attached on hydration; retry until it focuses the filter.
    await expect(async () => {
      await page.keyboard.press("/");
      await expect(box).toBeFocused({ timeout: 300 });
    }).toPass();
    await page.keyboard.type("adguard");
    await expect(page.getByText("AdGuard", { exact: true })).toBeVisible();
    await expect(page.getByText("Proxmox", { exact: true })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Proxmox", { exact: true })).toBeVisible();
  });

  test("collapsed groups stay collapsed after reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Money/ }).click();
    await expect(page.getByText("Ghostfolio", { exact: true })).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: /^Money/ })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: /^Money/ }).click();
    await expect(page.getByText("Ghostfolio", { exact: true })).toBeVisible();
  });

  test("editor adds a service and writes it to services.yaml", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Edit dashboard" }).click();
    await page.getByRole("button", { name: "Add service" }).first().click();
    await page.getByLabel("Name").fill("Playwright Service");
    await page.getByLabel("Link").fill("https://example.com");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Playwright Service")).toBeVisible();
    await expect.poll(() => readConfig("services")).toContain("name: Playwright Service");
    // Comments in the file survive the write.
    expect(readConfig("services")).toContain("# demo services");

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("link", { name: /Playwright Service/ })).toHaveAttribute("href", "https://example.com");
  });
});

test("imports a Homepage config from the editor (merge), with warnings, then restores", async ({ page }) => {
  const original = { services: readConfig("services"), settings: readConfig("settings"), bookmarks: readConfig("bookmarks"), widgets: readConfig("widgets") };
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Edit dashboard" }).click();
    await page.getByRole("button", { name: "Import" }).click();
    const dir = path.join(__dirname, "..", "fixtures", "homepage");
    await page.locator('input[type="file"][multiple]').setInputFiles(["services", "bookmarks", "settings", "widgets", "docker"].map((f) => path.join(dir, `${f}.yaml`)));
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("7 services in 3 groups");
    await expect(dialog).toContainText("ICMP ping");
    await shot(page, "60-homepage-import", { fullPage: false });
    await dialog.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText("Homepage config imported")).toBeVisible();
    const services = readConfig("services");
    // Merge: existing groups stay, new ones are added; Page-only settings (auth) survive.
    expect(services).toContain("name: Infra\n");
    expect(services).toContain("name: Infrastructure / Network");
    expect(readConfig("settings")).toContain("title: My Homelab");
    expect(readConfig("settings")).toContain("providers:");
  } finally {
    for (const [file, text] of Object.entries(original)) writeConfig(file, text);
  }
});
