import { expect, test, type Browser, type Page } from "@playwright/test";
import { totpCode } from "../../src/lib/auth/totp";
import { shot } from "./helpers";

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A request context signed in through the API (no UI). */
async function apiAs(browser: Browser, username: string, password: string) {
  const ctx = await browser.newContext();
  const res = await ctx.request.post("/api/auth", { data: { username, password } });
  expect(res.ok()).toBe(true);
  return ctx;
}

test.describe.serial("security", () => {
  test("two-factor sign-in, and signing out other devices", async ({ page, browser }) => {
    const admin = await apiAs(browser, "admin", "e2e-admin-pw");
    expect((await admin.request.post("/api/users", { data: { username: "tfa", password: "tfa-password-1", role: "user" } })).ok()).toBe(true);

    // The user turns 2FA on from another device (through the API here).
    const phone = await apiAs(browser, "tfa", "tfa-password-1");
    const start = await (await phone.request.post("/api/profile/2fa", { data: { action: "start" } })).json();
    expect(start.qr).toContain("<svg");
    const enabled = await (await phone.request.post("/api/profile/2fa", { data: { action: "enable", setup: start.setup, code: totpCode(start.secret) } })).json();
    expect(enabled.recoveryCodes).toHaveLength(10);

    // A password alone is no longer enough.
    await signIn(page, "tfa", "tfa-password-1");
    await expect(page.getByText("Enter the code from your authenticator app")).toBeVisible();
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Wrong code");
    await page.getByLabel("Code").fill(totpCode(start.secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: /Account/ }).click();
    await page.getByRole("menuitem", { name: /Security/ }).click();
    const dialog = page.getByRole("dialog", { name: "Security" });
    await expect(dialog).toContainText("On. Signing in with a password also asks for a code");
    await expect(dialog.getByText("this device")).toBeVisible();
    await shot(page, "40-security", { fullPage: false });
    await dialog.getByRole("button", { name: "Sign out the others" }).click();
    await expect(dialog.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    // The other device's session is gone.
    expect((await phone.request.get("/api/profile")).status()).toBe(401);
  });

  test("an admin's one-time link sets a password", async ({ page, browser }) => {
    const admin = await apiAs(browser, "admin", "e2e-admin-pw");
    const user = await (await admin.request.post("/api/users", { data: { username: "invitee", role: "user" } })).json();
    const { link } = await (await admin.request.patch(`/api/users/${user.id}`, { data: { resetLink: true } })).json();
    const url = new URL(link);
    await page.goto(url.pathname + url.search);
    await expect(page.getByText("invitee")).toBeVisible();
    await page.getByLabel("New password").fill("invitee-pw-1");
    await page.getByLabel("Repeat it").fill("invitee-pw-1");
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.getByText("Password set")).toBeVisible();
    // Used up.
    await page.goto(url.pathname + url.search);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("expired or was already used");
    await signIn(page, "invitee", "invitee-pw-1");
    await expect(page).toHaveURL("/");
  });

  test("the monitoring panel lists checked services", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Monitoring/ }).waitFor();
    await page.keyboard.press("m");
    const panel = page.getByRole("dialog", { name: "Monitoring" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("listitem").first()).toBeVisible();
    await shot(page, "41-monitoring", { fullPage: false });
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
});
