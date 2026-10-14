import { expect, test } from "@playwright/test";
import { readConfig, shot, writeConfig } from "./helpers";

const origin = (url: string) => ({ origin: new URL(url).origin });

test.describe.serial("finance rules and subscriptions", () => {
  test("a rule fills the category of a new transaction", async ({ page }) => {
    await page.goto("/finance");
    await page.getByRole("tab", { name: "Categories" }).click();
    const rules = page.getByRole("region", { name: "Rules" });
    await rules.getByLabel("Text to match").fill("NETFLIX");
    await rules.getByLabel("Category", { exact: true }).fill("Streaming");
    await rules.getByRole("button", { name: "Add rule" }).click();
    await expect(page.locator("[data-rule]")).toContainText("Streaming");
    await page.getByPlaceholder("NETFLIX.COM 866-579-7172").fill("netflix.com paris");
    await expect(page.getByRole("status").filter({ hasText: "→ Streaming" })).toBeVisible();

    const r = await page.request.post("/api/finance/transactions", { data: { date: "2026-10-05", amount: -13.99, description: "NETFLIX.COM 866" }, headers: origin(page.url()) });
    expect(r.ok()).toBe(true);
    const list = (await (await page.request.get("/api/finance/transactions?q=NETFLIX")).json()) as { description: string; category: string | null }[] | { items: { description: string; category: string | null }[] };
    const rows = Array.isArray(list) ? list : list.items;
    expect(rows.find((t) => t.description === "NETFLIX.COM 866")?.category).toBe("Streaming");
  });

  test("a subscription shows its renewal and monthly cost", async ({ page }) => {
    await page.goto("/finance");
    await page.getByRole("tab", { name: "Subscriptions" }).click();
    await page.getByRole("button", { name: "Add a subscription" }).click();
    const form = page.getByRole("form", { name: "Add a subscription" });
    await form.getByLabel("Name").fill("VPS");
    await form.getByLabel(/^Price in/).fill("5");
    await form.getByRole("combobox", { name: "Period" }).selectOption("month");
    const next = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await form.getByLabel("Next payment").fill(next);
    await form.getByRole("button", { name: "Save" }).click();
    const card = page.locator("[data-subscription='VPS']");
    await expect(card).toContainText(`renews ${next}`);
    await expect(page.getByText("Per month", { exact: true }).locator("..")).toContainText("5");
    await shot(page, "99-subscriptions", { fullPage: false });
  });
});

test.describe.serial("notes and runbooks", () => {
  test("a note linked to a service is its runbook", async ({ page }) => {
    await page.goto("/notes");
    await page.getByRole("button", { name: "New note" }).click();
    await page.getByLabel("Title").fill("Restart Portainer");
    await page.getByLabel("Text (Markdown)").fill("## Steps\n1. Open the host\n2. Run:\n\n```\ndocker restart portainer\n```\n");
    await page.getByRole("combobox", { name: "Link to a service" }).selectOption({ label: "Infra › Portainer" });
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(page.locator("pre code")).toHaveText("docker restart portainer");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("[data-note='Restart Portainer']")).toBeVisible();

    await page.goto("/service/infra.portainer");
    const runbook = page.locator("[data-runbook='Restart Portainer']");
    await expect(runbook).toContainText("docker restart portainer");
    await expect(runbook.locator("ol li")).toHaveCount(2);
    // The maintenance menu links to it.
    await page.getByRole("button", { name: "Start maintenance for Portainer" }).click();
    await expect(page.getByRole("link", { name: "Runbook: Restart Portainer" })).toBeVisible();
    await page.keyboard.press("Escape");
    await shot(page, "99-runbook", { fullPage: false });
  });
});

test.describe.serial("status page incidents", () => {
  let original = "";
  test.beforeAll(() => {
    original = readConfig("settings");
    writeConfig("settings", `${original.trimEnd()}\nstatusPage:\n  enabled: true\n`);
  });
  test.afterAll(() => writeConfig("settings", original));

  test("an incident and planned maintenance show on /status", async ({ page }) => {
    await page.goto("/service/infra.portainer");
    await page.getByRole("button", { name: "Post an incident about Portainer" }).click();
    await page.getByLabel("Incident title").fill("Containers are slow");
    await page.getByRole("combobox", { name: "Impact" }).selectOption("major");
    await page.getByLabel("First update").fill("Looking into it.");
    await page.getByRole("button", { name: "Post incident" }).click();
    await expect(page.locator("[data-incident='Containers are slow']")).toBeVisible();
    await page.keyboard.press("Escape");

    // Maintenance planned for tomorrow.
    const start = Date.now() + 86_400_000;
    const m = await page.request.post("/api/maintenance", { data: { kind: "maintenance", service: "infra.portainer", start, end: start + 3_600_000, publicNote: "New disks" }, headers: origin(page.url()) });
    expect(m.ok()).toBe(true);

    await page.goto("/status");
    await expect(page.getByRole("status")).toContainText("Containers are slow");
    await expect(page.locator("[data-posted='Containers are slow']")).toContainText("Looking into it.");
    await expect(page.locator("[data-upcoming]")).toContainText("New disks");
    await shot(page, "99-status-incident", { fullPage: false });
    const feed = (await (await page.request.get("/status/feed.json")).json()) as { posted: { title: string }[] };
    expect(feed.posted.map((p) => p.title)).toContain("Containers are slow");

    // Resolve it.
    const list = (await (await page.request.get("/api/status-incidents")).json()) as { id: number; title: string }[];
    const id = list.find((i) => i.title === "Containers are slow")!.id;
    await page.request.post(`/api/status-incidents/${id}`, { data: { status: "resolved", body: "Fixed." }, headers: origin(page.url()) });
    await page.reload();
    await expect(page.getByRole("status")).not.toContainText("Containers are slow");
    await expect(page.locator("[data-posted='Containers are slow']")).toContainText("Fixed.");

    // Leave nothing behind for the other status page tests.
    await page.request.delete(`/api/status-incidents/${id}`, { headers: origin(page.url()) });
    const planned = (await (await page.request.get("/api/maintenance")).json()) as { maintenance: { id: string }[] };
    for (const p of planned.maintenance) await page.request.delete(`/api/maintenance?maintenance=${p.id}`, { headers: origin(page.url()) });
  });
});
