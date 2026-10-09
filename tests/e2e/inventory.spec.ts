import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test.describe.serial("inventory", () => {
  test("devices with live status, Wake-on-LAN and CSV", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Apps" }).click();
    await page.getByRole("menuitem", { name: "Inventory" }).click();
    await expect(page).toHaveURL(/\/inventory$/);

    const add = async (v: Record<string, string>) => {
      await page.getByRole("button", { name: "Add device" }).click();
      // Required fields' labels end in " *".
      for (const [label, value] of Object.entries(v)) await page.getByRole("dialog").getByLabel(label, { exact: true }).fill(value);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    // Page itself answers on its port: "up". Nothing listens on port 1: "down".
    await add({ "Name *": "Page box", "IP address or host name": "127.0.0.1", "Check this TCP port": "3300", "MAC address": "aa-bb-cc-dd-ee-01", "Wake-on-LAN broadcast": "127.0.0.1:4011", Location: "Rack" });
    await add({ "Name *": "Old printer", "IP address or host name": "127.0.0.1", "Check this TCP port": "1", "Warranty until (YYYY-MM-DD)": "2020-01-01", Location: "Office" });
    await expect(page.locator("[data-device='Page box']").getByRole("img", { name: "Up" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-device='Old printer']").getByRole("img", { name: "Down" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Wake Page box" }).click();
    await expect(page.getByRole("status")).toContainText("AA:BB:CC:DD:EE:01");
    await expect.poll(async () => (await (await page.request.get("http://localhost:4010/_wol")).json()) as string[]).toContain("AA:BB:CC:DD:EE:01");

    await page.getByLabel("Location").selectOption("Office");
    await expect(page.locator("[data-device]")).toHaveCount(1);
    await page.getByLabel("Location").selectOption("");
    await shot(page, "99-inventory", { fullPage: false });

    // CSV export imports back without duplicates.
    const csv = await (await page.request.get("/api/inventory/csv")).text();
    expect(csv.split("\r\n")[0]).toMatch(/^name,kind,ip,mac/);
    const r = await (await page.request.post("/api/inventory/csv", { data: { text: csv } })).json();
    expect(r).toMatchObject({ added: 0, updated: 2 });
  });

  test("a service with wol: gets Wake in its menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Actions for Flaky" }).click();
    await page.getByRole("menuitem", { name: /Wake/ }).click();
    await page.getByRole("button", { name: /Wake/ }).last().click();
    await expect.poll(async () => (await (await page.request.get("http://localhost:4010/_wol")).json()) as string[]).toContain("DE:AD:BE:EF:00:01");
  });
});
