import { expect, test } from "@playwright/test";
import { setSetting, shot } from "./helpers";

// Screenshots for review rather than pixel assertions: live data (clock, resources) changes every run.

test.describe.serial("visual", () => {
  test.afterAll(() => {
    setSetting("style", "glass");
    setSetting("theme", "dark");
    setSetting("glow", "subtle");
    setSetting("background", "{ gradient: aurora }");
  });

  test("home tab, glass, dark", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Homelab" })).toBeVisible();
    await expect(page.getByText("VMs").first()).toBeVisible();
    await shot(page, "01-home-glass-dark");
  });

  test("network tab", async ({ page }) => {
    await page.goto("/network");
    await expect(page.getByText("Pi-hole", { exact: true })).toBeVisible();
    await shot(page, "02-network-tab");
  });

  for (const style of ["liquid", "minimal", "solid"]) {
    test(`style ${style}`, async ({ page }) => {
      setSetting("style", style);
      await page.goto("/");
      await expect(page.locator(`html[data-style="${style}"]`)).toBeAttached();
      await shot(page, `03-style-${style}`);
    });
  }

  test("frutiger aero, dark and light", async ({ page }) => {
    setSetting("style", "aero");
    setSetting("background", "{ gradient: aero }");
    await page.goto("/");
    await expect(page.locator('html[data-style="aero"]')).toBeAttached();
    await expect(page.locator(".bg-aero")).toBeAttached();
    await expect(page.locator(".aero-bubble")).toHaveCount(12);
    await shot(page, "03-style-aero");
    setSetting("theme", "light");
    await page.goto("/");
    await shot(page, "04-light-aero");
    setSetting("theme", "dark");
    setSetting("style", "glass");
    setSetting("background", "{ gradient: aurora }");
  });

  // The pointer light is off under reduced motion (the default for these tests).
  for (const style of ["glass", "liquid", "aero", "neon", "brutal"]) {
    test(`hover glow, ${style}`, async ({ page }) => {
      setSetting("style", style);
      setSetting("glow", "strong");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto("/");
      const card = page.locator(".glass-interactive").filter({ hasText: "Proxmox" }).first();
      await card.hover({ position: { x: 30, y: 20 } });
      await expect(card).toHaveAttribute("data-lit", "");
      await expect(card).toHaveCSS("--ang", /deg$/);
      await page.waitForTimeout(400);
      await card.screenshot({ path: `test-results/shots/03-hover-${style}.png` });
      await page.mouse.move(2, 2);
      await expect(card).not.toHaveAttribute("data-lit");
      setSetting("glow", "subtle");
      setSetting("style", "glass");
    });
  }

  // New card styles, dark and light, each over a background that suits it.
  for (const [style, gradient] of [
    ["neon", "synthwave"],
    ["brutal", "graphite"],
    ["soft", "dawn"],
    ["retro", "lagoon"],
  ] as const) {
    test(`style ${style}`, async ({ page }) => {
      setSetting("style", style);
      setSetting("background", `{ gradient: ${gradient} }`);
      await page.goto("/");
      await expect(page.locator(`html[data-style="${style}"]`)).toBeAttached();
      await shot(page, `05-style-${style}-dark`, { fullPage: false });
      setSetting("theme", "light");
      await page.goto("/");
      await shot(page, `05-style-${style}-light`, { fullPage: false });
      setSetting("theme", "dark");
      setSetting("style", "glass");
      setSetting("background", "{ gradient: aurora }");
    });
  }

  for (const gradient of ["nebula", "dawn", "lagoon", "graphite"]) {
    test(`background ${gradient}`, async ({ page }) => {
      setSetting("background", `{ gradient: ${gradient} }`);
      await page.goto("/");
      if (gradient === "nebula") await expect(page.locator(".nebula-stars")).toHaveCount(2);
      await shot(page, `06-bg-${gradient}`, { fullPage: false });
      setSetting("background", "{ gradient: aurora }");
    });
  }

  test("oled and sepia themes", async ({ page }) => {
    setSetting("theme", "oled");
    await page.goto("/");
    await expect(page.locator('html[data-theme="dark"][data-tone="oled"]')).toBeAttached();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await shot(page, "07-theme-oled", { fullPage: false });
    setSetting("theme", "sepia");
    await page.goto("/");
    await expect(page.locator('html[data-theme="light"][data-tone="sepia"]')).toBeAttached();
    await shot(page, "07-theme-sepia", { fullPage: false });
    setSetting("theme", "dark");
  });

  test("light theme", async ({ page }) => {
    setSetting("style", "glass");
    setSetting("theme", "light");
    await page.goto("/");
    await shot(page, "04-light");
    setSetting("style", "liquid");
    await page.goto("/");
    await expect(page.locator('html[data-style="liquid"][data-refract]')).toBeAttached();
    await shot(page, "04-light-liquid");
    setSetting("style", "glass");
    setSetting("theme", "dark");
  });

  test("phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await shot(page, "05-phone");
  });

  test("filter across tabs", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "Filter services and bookmarks" }).fill("ad");
    await shot(page, "06-filter");
  });

  test("editor and dialogs", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Edit dashboard" }).click();
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();
    await shot(page, "07-editor");
    await page.getByRole("button", { name: "Edit service" }).first().click();
    await shot(page, "08-service-dialog", { fullPage: false });
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await shot(page, "09-settings-page", { fullPage: false });
  });
});

test("home & storage, calendar and news tiles", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Living room")).toBeVisible();
  await expect(page.getByText("Dentist")).toBeVisible();
  await expect(page.getByRole("link", { name: "Jellyfin 10.11 released" })).toHaveAttribute("href", /example\.com/);
  await expect(page.getByText("1 degraded")).toBeVisible();
  await page.getByRole("button", { name: /^Home/ }).scrollIntoViewIfNeeded();
  await shot(page, "40-home-storage-calendar-news");
});
