import { expect, test, type Page } from "@playwright/test";
import { shot } from "./helpers";

const tile = (page: Page, name: string) => page.locator(".glass-interactive").filter({ has: page.getByText(name, { exact: true }) });
const field = (page: Page, service: string, label: string) =>
  tile(page, service).locator("div[title]").filter({ hasText: new RegExp(`^.*${label}$`, "i") });

test("apps tab: media, downloads, network edge and disks", async ({ page }) => {
  await page.goto("/apps");
  await expect(field(page, "Jellyfin", "Streams")).toContainText("2");
  await expect(field(page, "Sonarr", "Health")).toContainText("1 issue");
  await expect(field(page, "qBittorrent", "Seeding")).toContainText("3");
  await expect(field(page, "Immich", "Photos")).toContainText("48,213");
  await expect(field(page, "Traefik", "Routers")).toContainText("26");
  await expect(field(page, "Proxy Manager", "Proxy hosts")).toContainText("2 / 3");
  await expect(tile(page, "Proxy Manager")).toContainText("soon.example.com"); // large tile: certificate list
  await expect(field(page, "Tailscale", "Online")).toContainText("2 / 3");
  await expect(field(page, "Disks", "Failing").locator('[data-status="error"]')).toContainText("1");
  await expect(field(page, "Game servers", "Running")).toContainText("1");
  await expect(field(page, "Game servers", "Offline")).toContainText("2");
  await expect(field(page, "VPN", "Connected")).toContainText("1");
  await expect(field(page, "VPN", "Peers")).toContainText("3 / 4");
  await shot(page, "80-apps-tab");
});

test("wgdashboard: interfaces, peers and who was seen when", async ({ page }) => {
  await page.goto("/apps");
  await expect(field(page, "WGDashboard", "Connected")).toContainText("2");
  await expect(field(page, "WGDashboard", "Interfaces")).toContainText("1 / 2");
  // Large tile: the peer list, online ones first.
  await expect(tile(page, "WGDashboard")).toContainText("Phone (wg0)");
  await expect(tile(page, "WGDashboard")).toContainText("never connected");
  await expect(tile(page, "WGDashboard")).not.toContainText("SECRET");
  const res = await page.request.get("/api/widget/apps.wgdashboard");
  expect(res.ok()).toBe(true);
  const data = await res.text();
  expect(data).toContain("Phone");
  expect(data).not.toContain("SECRET");
  await tile(page, "WGDashboard").scrollIntoViewIfNeeded();
  await tile(page, "WGDashboard").screenshot({ path: "test-results/shots/81-wgdashboard-tile.png" });
});

test("pelican: power actions reach the panel", async ({ page }) => {
  const actions = await (await page.request.get("/api/actions/apps.game-servers")).json();
  expect(actions.map((a: { targetLabel: string; id: string }) => `${a.targetLabel}:${a.id}`)).toContain("Creative:start");
  const res = await page.request.post("/api/actions/apps.game-servers", { data: { action: "start", target: "5f2b8c10" } });
  expect(res.ok()).toBe(true);
  const calls = await (await page.request.get("http://localhost:4010/pelican/_calls")).json();
  expect(calls).toContainEqual({ server: "5f2b8c10", signal: "start" });
});

test("home assistant: a light switch and a scene button on the tile", async ({ page }) => {
  await page.goto("/");
  const ha = tile(page, "Home Assistant");
  const lamp = ha.getByRole("switch", { name: "Desk lamp" });
  await expect(lamp).toHaveAttribute("aria-checked", "false");
  await lamp.click();
  await expect(lamp).toHaveAttribute("aria-checked", "true");
  await ha.getByRole("button", { name: "Activate Movie night" }).click();
  await expect.poll(async () => (await (await page.request.get("http://localhost:4010/ha/_calls")).json()).length).toBe(2);
  const calls = await (await page.request.get("http://localhost:4010/ha/_calls")).json();
  expect(calls).toEqual([
    { domain: "light", service: "turn_on", entity_id: "light.desk" },
    { domain: "scene", service: "turn_on", entity_id: "scene.movie_night" },
  ]);
  // The real state comes back after the refetch, and the action is in the audit log.
  await page.waitForTimeout(1500);
  await expect(lamp).toHaveAttribute("aria-checked", "true");
  await expect(field(page, "Home Assistant", "Desk lamp")).toContainText("on");
  await ha.scrollIntoViewIfNeeded();
  await ha.screenshot({ path: "test-results/shots/82-homeassistant-controls.png" });
  const audit = await (await page.request.get("/api/audit")).json();
  expect(JSON.stringify(audit)).toContain("light.desk");
});
