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
  await shot(page, "80-apps-tab");
});
