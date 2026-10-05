import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test.describe.serial("service detail and actions", () => {
  test("detail page shows availability, latency and incidents", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Flaky: uptime details" }).click();
    await expect(page).toHaveURL(/\/service\/infra\.flaky$/);
    await expect(page.getByRole("heading", { name: "Flaky" })).toBeVisible();
    await expect(page.getByText("Uptime", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Availability per time slot" })).toBeVisible();
    await page.getByRole("tab", { name: "7d" }).click();
    await expect(page.getByRole("tab", { name: "7d" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Outage").first()).toBeVisible();
    await shot(page, "30-service-detail-7d");
    await page.getByRole("tab", { name: "30d" }).click();
    await expect(page.getByText("ECONNREFUSED")).toBeVisible();
    // Hover the latency chart for the crosshair tooltip.
    const chart = page.getByRole("img", { name: /Response time/ });
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await shot(page, "32-service-detail-30d");
  });

  test("admin powers on a Proxmox VM after confirming", async ({ page }) => {
    await page.goto("/service/infra.proxmox");
    await page.getByRole("button", { name: "Actions for Proxmox" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("win11");
    await shot(page, "31-action-menu", { fullPage: false });
    // win11 is stopped, so Start is its only action.
    await menu.getByRole("menuitem", { name: "Start win11" }).click();
    await expect(page.getByRole("dialog")).toContainText("Start win11?");
    await page.getByRole("dialog").getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("status")).toContainText("VM 103: start requested");

    const calls = await (await page.request.get("http://localhost:4010/pve/_calls")).json();
    expect(calls).toContainEqual({ node: "pve1", type: "qemu", vmid: 103, action: "start" });
  });

  test("Proxmox deep-dive: nodes, storage, backups, guest charts and snapshots", async ({ page }) => {
    await page.goto("/service/infra.proxmox");
    const live = page.locator("section").filter({ hasText: "Live data" });
    await expect(live.locator('[data-status="error"]', { hasText: "2 / 4" })).toBeVisible(); // Backups field
    await expect(page.getByRole("region", { name: "Nodes" })).toContainText("pve1");
    await expect(page.getByRole("region", { name: "Storage" })).toContainText("nas-backup (shared)");
    const backups = page.getByRole("region", { name: "Backups" });
    await expect(backups).toContainText("last backup failed");
    await expect(backups).toContainText("not in a backup job");

    await page.getByRole("button", { name: "home-assistant" }).click();
    const charts = page.getByRole("region", { name: "Charts for home-assistant" });
    await expect(charts.getByRole("img", { name: "home-assistant: CPU over the last 1h" })).toBeVisible();
    await expect(charts.getByRole("img", { name: "home-assistant: Network over the last 1h" })).toBeVisible();
    await shot(page, "33-proxmox-detail");

    await page.getByRole("button", { name: "Actions for Proxmox" }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Take snapshot home-assistant" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Take snapshot" }).click();
    await expect(page.getByRole("status")).toContainText(/VM 102: snapshot page-\d{12} requested/);
    const calls = (await (await page.request.get("http://localhost:4010/pve/_calls")).json()) as { action: string; vmid: number; snapname?: string }[];
    expect(calls.find((c) => c.action === "snapshot")).toMatchObject({ vmid: 102, snapname: expect.stringMatching(/^page-\d{12}$/) });
  });

  test("Proxmox Backup Server tile and page", async ({ page }) => {
    await page.goto("/service/infra.pbs");
    const live = page.locator("section").filter({ hasText: "Live data" });
    await expect(live.locator('[data-status="warn"]', { hasText: "78%" }).first()).toBeVisible();
    await expect(live.getByText("Failed 24h")).toBeVisible();
    await expect(page.getByRole("region", { name: "Failed tasks (24h)" })).toContainText("verification failed");
    await expect(page.getByRole("region", { name: "Datastores" })).toContainText("main");
  });

  test("actions are refused for non-admins and for actions not on offer", async ({ page, browser }) => {
    // Not offered: win11 is stopped, so "stop" isn't in the list.
    const res = await page.request.post("/api/actions/infra.proxmox", {
      data: { action: "stop", target: "pve1/qemu/103" },
      headers: { Origin: "http://localhost:3300" },
    });
    expect(res.status()).toBe(409);

    // An explicitly empty session: the project would otherwise lend this context its admin cookies.
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const r2 = await anon.request.post("http://localhost:3300/api/actions/infra.proxmox", { data: { action: "start", target: "pve1/qemu/103" } });
    expect(r2.status()).toBe(403);
    await anon.close();
  });
});
