import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test.describe.serial("tasks", () => {
  test("a board: add tasks, move them along, edit, filter, list view", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Apps" }).click();
    await page.getByRole("menuitem", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();

    // A first board comes with the three usual columns.
    const column = (name: string) => page.getByRole("region", { name, exact: true });
    for (const name of ["To do", "In progress", "Done"]) await expect(column(name)).toBeVisible();

    for (const title of ["Renew the certificate", "Back up the NAS", "Order a fan"]) {
      await column("To do").getByLabel("Add a task to To do").fill(title);
      await column("To do").getByLabel("Add a task to To do").press("Enter");
      await expect(column("To do").getByRole("button", { name: title })).toBeVisible();
    }
    await expect(page.getByText("3 open tasks")).toBeVisible();

    // Details: priority, due date in the past, labels.
    await column("To do").getByRole("button", { name: "Back up the NAS" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit task" });
    await dialog.getByLabel("Priority").selectOption("3");
    await dialog.getByLabel("Due date").fill("2020-01-01");
    await dialog.getByLabel("Labels (comma-separated)").fill("infra, weekly");
    await dialog.getByLabel("Notes (Markdown)").fill("1. Snapshot\n2. Copy off-site");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("1 overdue")).toBeVisible();
    await expect(column("To do").getByRole("img", { name: "High" })).toBeVisible();

    // Drag the first task to "In progress".
    const card = column("To do").getByRole("button", { name: "Renew the certificate" });
    const target = column("In progress").getByLabel("Add a task to In progress");
    const from = (await card.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y - 20, { steps: 12 });
    // The board shows the move at once, then redraws with the server's answer: wait for it, so the
    // next click doesn't land on a card being replaced.
    const saved = page.waitForResponse((r) => r.url().includes("/api/tasks/items") && r.request().method() === "PATCH");
    await page.mouse.up();
    await saved;
    await expect(column("In progress").getByRole("button", { name: "Renew the certificate" })).toBeVisible();
    await expect(column("To do").getByRole("button", { name: "Renew the certificate" })).toHaveCount(0);

    // Through the dialog to "Done": it counts as finished.
    await column("To do").getByRole("button", { name: "Order a fan" }).click();
    await page.getByRole("dialog").getByLabel("Column").selectOption({ label: "Done" });
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(column("Done").getByRole("button", { name: "Order a fan" })).toBeVisible();
    await expect(page.getByText("2 open tasks")).toBeVisible();
    await shot(page, "96-tasks-board", { fullPage: false });

    // The moves were saved.
    await page.reload();
    await expect(column("In progress").getByRole("button", { name: "Renew the certificate" })).toBeVisible();
    await expect(column("Done").getByRole("button", { name: "Order a fan" })).toBeVisible();

    // A column of one's own, renamed.
    await page.getByRole("button", { name: "Add column" }).click();
    await page.getByRole("dialog", { name: "New column" }).getByLabel("Name").fill("Waiting");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(column("Waiting")).toBeVisible();
    await page.getByRole("button", { name: "Column options: Waiting" }).click();
    await page.getByRole("menuitem", { name: "Move left" }).click();
    await expect(page.getByRole("region").nth(2)).toHaveAccessibleName("Waiting");

    // Filter by label, then the list view.
    await page.getByLabel("Label", { exact: true }).selectOption("infra");
    await expect(column("To do").getByRole("button", { name: "Back up the NAS" })).toBeVisible();
    await expect(column("In progress").getByRole("button", { name: "Renew the certificate" })).toHaveCount(0);
    await page.getByLabel("Label", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByRole("row")).toHaveCount(4);
    await page.getByLabel("Column of Back up the NAS").selectOption({ label: "In progress" });
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(column("In progress").getByRole("button", { name: "Back up the NAS" })).toBeVisible();
  });

  test("a second board, and deleting it", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByRole("dialog", { name: "New board" }).getByLabel("Name").fill("House");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByLabel("Board", { exact: true })).toHaveValue(/\d+/);
    await expect(page.getByLabel("Board", { exact: true }).locator("option:checked")).toHaveText("House");
    await expect(page.getByText("0 open tasks")).toBeVisible();

    await page.getByRole("button", { name: "Delete board" }).click();
    await page.getByRole("button", { name: "Confirm: Delete board" }).click();
    await expect(page.getByLabel("Board", { exact: true }).locator("option:checked")).toHaveText("My board");
    await expect(page.getByText("2 open tasks")).toBeVisible();
  });

  test("a repeating task with a checklist, about a service", async ({ page }) => {
    const column = (name: string) => page.getByRole("region", { name, exact: true });

    // From a service's page: a new task about that service.
    await page.goto("/service/infra.proxmox");
    await page.getByRole("link", { name: "New task about this service" }).click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await expect(dialog.getByLabel("About service")).toHaveValue("infra.proxmox");
    await dialog.getByLabel("Title").fill("Patch Proxmox");
    await dialog.getByLabel("Due date").fill("2099-01-05");
    await dialog.getByLabel("Repeat", { exact: true }).selectOption("on");
    await dialog.getByLabel("Repeat every").fill("2");
    await dialog.getByLabel("Repeat unit").selectOption("week");
    for (const item of ["Update packages", "Reboot"]) {
      await dialog.getByLabel("New checklist item").fill(item);
      await dialog.getByLabel("New checklist item").press("Enter");
    }
    await dialog.getByLabel("Done: Update packages").check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(column("To do").getByRole("button", { name: /Patch Proxmox/ })).toContainText("1/2");

    // The service's page lists it, and opens it on its board.
    await page.goto("/service/infra.proxmox");
    const tasks = page.getByRole("region", { name: "Tasks", exact: true });
    await expect(tasks).toContainText("Patch Proxmox");
    await expect(tasks).toContainText("1/2");
    await tasks.getByRole("link", { name: /Patch Proxmox/ }).click();

    // Finished: the next one is made, two weeks later, its checklist unticked.
    const edit = page.getByRole("dialog", { name: "Edit task" });
    await edit.getByLabel("Column").selectOption({ label: "Done" });
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit).toHaveCount(0);
    await expect(column("Done").getByRole("button", { name: /Patch Proxmox/ })).toBeVisible();
    const next = column("To do").getByRole("button", { name: /Patch Proxmox/ });
    await expect(next).toContainText("0/2");
    await next.click();
    await expect(page.getByRole("dialog", { name: "Edit task" }).getByLabel("Due date")).toHaveValue("2099-01-19");
  });
  test("connect Claude: a token of your own, the command to add it, and revoking it", async ({ page, request }) => {
    await page.goto("/tasks");
    await page.getByRole("button", { name: "Connect Claude" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect Claude" });
    await dialog.getByLabel("Token name").fill("Claude e2e");
    await dialog.getByRole("button", { name: "Create token" }).click();
    const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
    expect(token).toMatch(/^page_/);
    await expect(dialog.getByLabel("Command")).toContainText(`claude mcp add --transport http nanodash`);
    await expect(dialog.getByLabel("Command")).toContainText(`/api/mcp --header "Authorization: Bearer ${token}"`);

    // The token works on the MCP endpoint, as Claude would use it.
    const rpc = (method: string, params: object = {}) =>
      request.post("/api/mcp", { headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: 1, method, params } });
    const listed = await (await rpc("tools/list")).json();
    expect(listed.result.tools.map((t: { name: string }) => t.name)).toContain("add_task");

    await dialog.getByRole("button", { name: "Revoke Claude e2e" }).click();
    await dialog.getByRole("button", { name: "Confirm: Revoke Claude e2e" }).click();
    await expect(dialog.getByRole("list", { name: "Your Claude tokens" })).toHaveCount(0);
    expect((await rpc("tools/list")).status()).toBe(401);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
  });
  test("claude.ai connector: discover, sign in, approve, and use the token", async ({ browser, request, baseURL }) => {
    // A loopback callback on the mock server: a redirect to a real site would leave the test machine.
    const CALLBACK = "http://localhost:4010/oauth/callback";
    // What claude.ai does: find the authorization server from /api/mcp's 401, then register.
    const challenge401 = await request.post("/api/mcp", { data: {} });
    expect(challenge401.status()).toBe(401);
    const meta = /resource_metadata="([^"]+)"/.exec(challenge401.headers()["www-authenticate"])![1];
    const [server] = (await (await request.get(meta)).json()).authorization_servers;
    const as = await (await request.get(`${server}/.well-known/oauth-authorization-server`)).json();
    const reg = await (await request.post(as.registration_endpoint, { data: { client_name: "Claude", redirect_uris: [CALLBACK] } })).json();

    const verifier = crypto.randomBytes(32).toString("base64url");
    const auth = new URL(as.authorization_endpoint);
    Object.entries({ client_id: reg.client_id, redirect_uri: CALLBACK, response_type: "code", code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "st8", scope: "tasks" }).forEach(([k, v]) =>
      auth.searchParams.set(k, v),
    );

    // A browser that isn't signed in: sign in first, then land on the consent page.
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto(auth.href);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("e2e-admin-pw");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Allow Claude to manage your tasks?" })).toBeVisible();
    await expect(page.getByText("localhost:4010", { exact: true })).toBeVisible();
    await shot(page, "oauth-consent");
    await page.getByRole("button", { name: "Allow" }).click();
    await page.waitForURL(/^http:\/\/localhost:4010\/oauth\/callback/);
    const back = new URL(page.url());
    expect(back.searchParams.get("state")).toBe("st8");
    const code = back.searchParams.get("code")!;
    await ctx.close();

    const token = await (await request.post(as.token_endpoint, { form: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: CALLBACK } })).json();
    expect(token).toMatchObject({ token_type: "Bearer", scope: "tasks" });
    const call = await request.post("/api/mcp", {
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_task", arguments: { title: "From claude.ai", column: "To do" } } },
    });
    expect(JSON.parse((await call.json()).result.content[0].text)).toMatchObject({ title: "From claude.ai", column: "To do" });
  });

  test("claude.ai connector: declining sends the app an error, not a code", async ({ page, request }) => {
    // A loopback callback on the mock server: a redirect to a real site would leave the test machine.
    const CALLBACK = "http://localhost:4010/oauth/callback";
    const reg = await (await request.post("/api/oauth/register", { data: { client_name: "Claude", redirect_uris: [CALLBACK] } })).json();
    const q = new URLSearchParams({ client_id: reg.client_id, redirect_uri: CALLBACK, response_type: "code", code_challenge: "x".repeat(43), code_challenge_method: "S256", state: "no" });
    await page.goto(`/oauth/authorize?${q}`);
    await page.getByRole("button", { name: "Deny" }).click();
    await page.waitForURL(/^http:\/\/localhost:4010\/oauth\/callback/);
    expect(new URL(page.url()).searchParams.get("error")).toBe("access_denied");
    expect(new URL(page.url()).searchParams.get("code")).toBeNull();
  });
});
