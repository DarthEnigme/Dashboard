import { expect, test } from "@playwright/test";
import { readConfig, shot, writeConfig } from "./helpers";

test.describe.serial("monitoring and live reload", () => {
  test("monitoring tiles show metrics, sparklines and lists", async ({ page }) => {
    await page.goto("/monitoring");
    await expect(page.getByText("2 / 3")).toBeVisible(); // Prometheus targets
    await expect(page.getByRole("img", { name: /^CPU, latest 43%/ })).toBeVisible(); // sparkline
    await expect(page.getByText("DiskFull")).toBeVisible(); // Grafana firing alert
    await expect(page.getByText("/mnt/tank")).toBeVisible(); // Glances disk list
    await expect(page.getByText("immich_ml").first()).toBeVisible(); // Dockhand list
    await expect(page.getByText("traefik ↑")).toBeVisible(); // Arcane update marker
    await expect(page.getByText("0.82")).toBeVisible(); // generic metric
    await shot(page, "50-monitoring");
  });

  test("info bar shows Prometheus stats", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Cluster")).toBeVisible();
    await expect(page.getByText("Pods", { exact: true }).first()).toBeVisible();
  });

  test("typed status checks (tcp, http with a JSON value) and their editor", async ({ page }) => {
    await page.goto("/");
    const portainer = page.locator(".glass-interactive").filter({ hasText: "Portainer" });
    await expect(portainer.getByText(/^Up · \d+ ms$/)).toBeAttached({ timeout: 15_000 });
    const kuma = page.locator(".glass-interactive").filter({ hasText: "Kuma" });
    await expect(kuma.getByText(/^Up · \d+ ms · HTTP 200$/)).toBeAttached({ timeout: 15_000 });

    await page.getByRole("button", { name: "Edit dashboard" }).click();
    await page.getByRole("button", { name: "Edit service" }).nth(1).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Status check")).toHaveValue("tcp");
    await expect(dialog.getByLabel("Host")).toHaveValue("localhost");
    await expect(dialog.getByLabel("Port")).toHaveValue("4010");
    await dialog.getByLabel("Status check").selectOption("dns");
    await expect(dialog.getByLabel("Name to resolve")).toBeVisible();
    await shot(page, "41-check-editor", { fullPage: false });
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("recorded widget history, threshold colours and alerts", async ({ page, request }) => {
    await page.goto("/");
    const custom = page.locator(".glass-interactive").filter({ hasText: "Custom" });
    // Load is 37.5% and the threshold is 30: the field is red.
    await expect(custom.locator('[data-status="error"]', { hasText: "38%" })).toBeVisible();

    await page.goto("/service/infra.custom");
    const history = page.getByRole("region", { name: "History" });
    await expect(async () => {
      await page.reload();
      await expect(history.getByRole("img", { name: "Users over the last 24h" })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 40_000 });
    await expect(history.getByText("now 1,234")).toBeVisible();
    await shot(page, "42-metrics-history");

    await expect(async () => {
      const hooks = (await (await request.get("http://localhost:4010/webhook")).json()) as { kind?: string; field?: string; state?: string }[];
      expect(hooks.some((h) => h.kind === "threshold" && h.field === "Load" && h.state === "breach")).toBe(true);
    }).toPass({ timeout: 30_000 });
  });

  test("admin restarts a container through Dockhand", async ({ page }) => {
    await page.goto("/service/monitoring.dockhand");
    await page.getByRole("button", { name: "Actions for Dockhand" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Restart jellyfin" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Restart" }).click();
    await expect(page.getByRole("status")).toContainText("jellyfin: restarted");
  });

  test("an open dashboard updates when a config file changes on disk", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Homelab" })).toBeVisible();
    const original = readConfig("settings");
    try {
      writeConfig("settings", original.replace(/^title: .*$/m, "title: Live Lab"));
      await expect(page.getByRole("heading", { name: "Live Lab" })).toBeVisible({ timeout: 8000 });
    } finally {
      writeConfig("settings", original);
    }
    await expect(page.getByRole("heading", { name: "Homelab" })).toBeVisible({ timeout: 8000 });
  });
});
