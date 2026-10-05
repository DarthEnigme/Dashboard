import { expect, test, type Page } from "@playwright/test";
import { readConfig, shot, writeConfig } from "./helpers";

const MOCK = "http://localhost:4010";

/** Choose who the mock identity provider signs in next. */
async function ssoAs(page: Page, email: string, extra = "") {
  await page.request.get(`${MOCK}/oidc/_as?email=${encodeURIComponent(email)}${extra}`);
}

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe.serial("authentication", () => {
  test("anonymous visitors see public items only and no editor", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Proxmox", { exact: true })).toBeVisible();
    // "Money" is visible: users.
    await expect(page.getByText("Firefly", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Edit dashboard" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    // The API agrees with the page.
    const res = await page.request.get("/api/widget/money.firefly");
    expect(res.status()).toBe(404);
  });

  test("login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Continue with Mock SSO" })).toBeVisible();
    await shot(page, "20-login", { fullPage: false });
  });

  test("wrong password is refused", async ({ page }) => {
    await signIn(page, "admin", "not-the-password");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Wrong username or password");
  });

  test("admin signs in with a password and sees everything", async ({ page }) => {
    await signIn(page, "admin", "e2e-admin-pw");
    await expect(page).toHaveURL("/");
    await expect(page.getByText("Firefly", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit dashboard" })).toBeVisible();
    await page.getByRole("button", { name: /Account/ }).click();
    await expect(page.getByRole("menu")).toContainText("Admin");
    await shot(page, "21-user-menu", { fullPage: false });
  });

  test("SSO refuses people without an account (signups disabled)", async ({ page }) => {
    await ssoAs(page, "stranger@example.com");
    await page.goto("/login");
    await page.getByRole("link", { name: "Continue with Mock SSO" }).click();
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("No Page account for stranger@example.com");
  });

  test("admin invites a user, who then signs in with SSO by verified email", async ({ page }) => {
    await signIn(page, "admin", "e2e-admin-pw");
    await page.getByRole("button", { name: "Edit dashboard" }).click();
    await page.getByRole("tab", { name: "Users" }).click();
    await page.getByRole("button", { name: "Add user" }).click();
    await page.getByLabel("Username").fill("alice");
    await page.getByLabel("Email").fill("alice@example.com");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("alice@example.com")).toBeVisible();
    await shot(page, "22-users-panel");

    await page.context().clearCookies();
    await ssoAs(page, "alice@example.com", "&name=Alice%20Example");
    await page.goto("/login");
    await page.getByRole("link", { name: "Continue with Mock SSO" }).click();
    await expect(page).toHaveURL("/");
    // A regular user: sees users-only items, cannot edit.
    await expect(page.getByText("Firefly", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit dashboard" })).toBeHidden();
    await page.getByRole("button", { name: /Account/ }).click();
    await expect(page.getByRole("menu")).toContainText("User · alice");
  });

  test("an unverified email is not enough", async ({ page }) => {
    await ssoAs(page, "alice@example.com", "&sub=someone-else&verified=0");
    await page.goto("/login");
    await page.getByRole("link", { name: "Continue with Mock SSO" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("No Page account");
  });

  test("editor changes can be undone and appear in history", async ({ page }) => {
    await signIn(page, "admin", "e2e-admin-pw");
    await page.getByRole("button", { name: "Edit dashboard" }).click();
    const before = readConfig("bookmarks");
    await page.getByRole("button", { name: "Delete bookmark" }).first().click();
    await page.getByRole("button", { name: /Confirm: Delete bookmark/ }).click();
    await expect.poll(() => readConfig("bookmarks")).not.toBe(before);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Change undone")).toBeVisible();
    await expect.poll(() => readConfig("bookmarks")).toBe(before);

    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByText("bookmarks.yaml").first()).toBeVisible();
    await shot(page, "23-history-panel");
  });

  test("private mode sends visitors to the login page", async ({ page }) => {
    const original = readConfig("settings");
    writeConfig("settings", original.replace("auth:\n", "auth:\n  publicView: false\n"));
    try {
      await page.goto("/");
      await expect(page).toHaveURL(/\/login$/);
      const cfg = await (await page.request.get("/api/config")).json();
      expect(cfg.services).toEqual([]);
      expect((await page.request.get("/api/widget/infra.proxmox")).status()).toBe(404);
    } finally {
      writeConfig("settings", original);
    }
  });
});
