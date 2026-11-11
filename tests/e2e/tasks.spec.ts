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
});
