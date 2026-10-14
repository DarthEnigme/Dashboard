import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test.describe.serial("watchlist", () => {
  test("add a book from Open Library, read it, finish it", async ({ page }) => {
    await page.goto("/watchlist");
    await expect(page.getByRole("heading", { name: "Watchlist", level: 1 })).toBeVisible();

    await page.getByLabel("Title").first().fill("dune");
    await page.getByRole("option", { name: /^Dune Frank Herbert · 1965 · 612 pages/ }).click();
    // A movie typed by hand.
    await page.getByRole("combobox", { name: "Kind" }).selectOption("movie");
    await page.getByLabel("Title").first().fill("Arrival");
    await page.getByLabel("By").fill("Denis Villeneuve");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await page.getByRole("tab", { name: /Planned/ }).click();
    await expect(page.locator("[data-watch='Dune']")).toBeVisible();
    await expect(page.locator("[data-watch='Arrival']")).toBeVisible();

    // Start reading: progress shows on the cover.
    await page.locator("[data-watch='Dune']").click();
    await page.getByRole("radio", { name: "In progress" }).click();
    await page.getByLabel("Progress").fill("306");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("tab", { name: /In progress/ }).click();
    await expect(page.getByRole("progressbar", { name: "Dune progress" })).toHaveAttribute("aria-valuenow", "50");
    await shot(page, "98-watchlist", { fullPage: false });

    // Finish it: counted this year, pages included.
    await page.locator("[data-watch='Dune']").click();
    await page.getByRole("radio", { name: "Finished" }).click();
    await page.getByRole("radio", { name: "5 of 5" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByLabel("Watchlist stats")).toContainText("612");
    await page.getByRole("tab", { name: /Finished/ }).click();
    await expect(page.locator("[data-watch='Dune']")).toBeVisible();
  });
});

test.describe.serial("watchlist lists, tags and sync", () => {
  test("tag an item, put it on a list, and sync from Jellyfin", async ({ page }) => {
    await page.goto("/watchlist");
    await page.getByRole("tab", { name: /Planned/ }).click();
    await page.locator("[data-watch='Arrival']").click();
    await page.getByLabel("List", { exact: true }).fill("Sci-fi night");
    await page.getByLabel("Tags (comma-separated)").fill("sci-fi, with Sam");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "with Sam" }).click();
    await expect(page.locator("[data-watch='Arrival']")).toBeVisible();
    await page.getByRole("button", { name: "with Sam" }).click();

    await page.getByText("Sync from Jellyfin or Plex").click();
    await page.getByLabel("Your name on that server").fill("tester");
    await page.getByRole("button", { name: "Link" }).click();
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByRole("status").filter({ hasText: "1 added, 1 updated." })).toBeVisible();
    await page.getByRole("tab", { name: /Finished/ }).click();
    await expect(page.locator("[data-watch='Arrival']")).toBeVisible();
    await expect(page.locator("[data-watch='Severance']")).toBeVisible();
  });
});
