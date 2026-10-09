import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test.describe.serial("travel log", () => {
  test("a trip with two cities colours two countries on the globe", async ({ page }) => {
    await page.goto("/");
    // Finance and Travel: the header groups them in an Apps menu.
    await page.getByRole("button", { name: "Apps" }).click();
    await page.getByRole("menuitem", { name: "Travel" }).click();
    await expect(page).toHaveURL(/\/travel$/);
    await expect(page.getByRole("img", { name: "Map of the countries you have visited" })).toBeVisible();

    await page.getByRole("button", { name: "New trip" }).click();
    await page.getByLabel("Name").fill("Spring tour");
    const search = page.getByRole("dialog").getByLabel("Search a city");
    await search.fill("Lis");
    await page.getByRole("option", { name: /Lisbon/ }).click();
    await search.fill("Kyo");
    await page.getByRole("option", { name: /Kyoto/ }).click();
    await expect(page.getByRole("list", { name: "Stops" }).getByRole("listitem")).toHaveCount(2);
    await page.getByRole("radio", { name: "4 of 5" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.locator("canvas[data-visited='2']")).toBeAttached();
    await expect(page.getByLabel("Travel stats")).toContainText("2 / 195");
    await page.waitForTimeout(800);
    await shot(page, "95-travel-globe", { fullPage: false });

    // Pick a country by name and mark it as a wish.
    await page.getByLabel("Pick a country").selectOption("IS");
    await expect(page.locator("[data-country='IS']")).toContainText("Iceland");
    await page.getByRole("group", { name: "Mark as" }).getByRole("button", { name: "Want to go" }).click();
    await expect(page.getByRole("group", { name: "Mark as" }).getByRole("button", { name: "Want to go" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Flat map" }).click();
    await page.waitForTimeout(300);
    await shot(page, "96-travel-flat", { fullPage: false });

    await page.getByRole("tab", { name: "Trips" }).click();
    const trip = page.locator("[data-trip='Spring tour']");
    await expect(trip).toContainText("Lisbon");
    await expect(trip).toContainText("Kyoto");
    await page.getByRole("tab", { name: "Places" }).click();
    await expect(page.locator("[data-place='IS']")).toContainText("Want to go");
    await shot(page, "97-travel-places", { fullPage: false });
  });

  test("other people can't read my travel log", async ({ browser }) => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await anon.request.get("http://localhost:3300/api/travel");
    expect(res.status()).toBe(401);
    await anon.close();
  });
});
