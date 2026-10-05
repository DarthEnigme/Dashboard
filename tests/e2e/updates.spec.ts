import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

// The e2e app checks the mock GitHub API (PAGE_UPDATE_FEED, PAGE_REPO=test/page), where v0.9.0 is
// the newest stable release. The app doesn't run in Docker, so it can't install it itself.

test.describe.serial("updates", () => {
  test("finds a new release, shows its notes and explains how to install it", async ({ page }) => {
    await page.goto("/settings#updates");
    const panel = page.getByTestId("updates-panel");
    await panel.getByRole("button", { name: "Check now" }).click();
    await expect(panel.getByRole("status")).toContainText("0.9.0 is available");
    await expect(panel.getByText("New", { exact: true })).toBeVisible();
    // Release notes rendered from Markdown (bold, code, links), pre-releases ignored.
    await expect(panel.getByRole("heading", { name: "What's new in 0.9.0" })).toBeVisible();
    await expect(panel.locator("strong", { hasText: "Faster" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "the issue" })).toHaveAttribute("href", "https://example.com/issues/1");
    // Not in Docker: no install button, manual steps instead.
    await expect(panel.getByRole("button", { name: /Update to/ })).toHaveCount(0);
    await expect(panel.getByText("docker compose pull && docker compose up -d")).toBeVisible();
    await shot(page, "63-settings-updates", { fullPage: false });
  });

  test("admins see a badge on the settings button", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Settings (update 0.9.0 available)" })).toBeVisible();
  });

  test("installing is refused outside Docker and for non-admins", async ({ page, browser }) => {
    const res = await page.request.post("/api/update/apply", { data: {} });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/isn't running in Docker/);

    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    expect((await anon.request.get("http://localhost:3300/api/update")).status()).toBe(403);
    expect((await anon.request.post("http://localhost:3300/api/update/apply", { data: {} })).status()).toBe(403);
    await anon.close();
  });

  test("the alert channels heard about the new version once", async ({ request }) => {
    await expect(async () => {
      const hooks = (await (await request.get("http://localhost:4010/webhook")).json()) as { kind?: string; version?: string }[];
      expect(hooks.filter((h) => h.kind === "update" && h.version === "0.9.0")).toHaveLength(1);
    }).toPass({ timeout: 15_000 });
  });
});
