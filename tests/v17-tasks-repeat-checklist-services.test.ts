import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addUnits, nextDue } from "@/lib/tasks/repeat";
import { addTask, loadBoard, tasksForService, updateColumn, updateTask, type BoardNames, type Task } from "@/lib/tasks/store";

const user = (name: string) => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, 'user', ?)").run(name, Date.now()).lastInsertRowid);
const NAMES: BoardNames = { board: "My board", columns: ["To do", "In progress", "Done"] };
let me = 0;
let other = 0;

beforeEach(() => {
  db().exec("DELETE FROM task_boards; DELETE FROM users;");
  me = user("me");
  other = user("other");
});

const board = (userId = me) => loadBoard(userId, undefined, NAMES).board;
const all = (userId = me): Task[] => board(userId).columns.flatMap((c) => c.tasks);
const named = (title: string) => all().filter((t) => t.title === title);
const column = (i: number, userId = me) => board(userId).columns[i].id;
const add = (title: string, extra: Record<string, unknown> = {}, userId = me) => addTask(userId, { column: column(0, userId), title, ...extra });
const finish = (t: Task) => updateTask(me, { id: t.id, column: column(2) });

describe("repeat dates", () => {
  it("moves on by days, weeks and months, keeping the day of the month where it can", () => {
    expect(addUnits("2026-11-13", 3, "day")).toBe("2026-11-16");
    expect(addUnits("2026-12-28", 1, "week")).toBe("2027-01-04");
    expect(addUnits("2026-01-31", 1, "month")).toBe("2026-02-28");
    expect(addUnits("2028-01-31", 1, "month")).toBe("2028-02-29");
    expect(addUnits("2026-11-30", 3, "month")).toBe("2027-02-28");
  });

  it("is due one repeat later, and never in the past", () => {
    const weekly = { every: 1, unit: "week" } as const;
    expect(nextDue("2026-11-13", weekly, "2026-11-10")).toBe("2026-11-20");
    // Finished late: the next one is the first that isn't past.
    expect(nextDue("2026-10-01", weekly, "2026-11-13")).toBe("2026-11-19");
    // Without a due date, it counts from today.
    expect(nextDue(null, { every: 2, unit: "day" }, "2026-11-13")).toBe("2026-11-15");
    // Months count from the first date, so they don't drift: Jan 31 → Feb 28 → Mar 31.
    expect(nextDue("2026-01-31", { every: 1, unit: "month" }, "2026-03-01")).toBe("2026-03-31");
  });
});

describe("repeating tasks", () => {
  it("makes the next one when it is finished, and only once", () => {
    add("Patch the servers", { repeat: { every: 1, unit: "week" }, due: "2099-01-05", labels: ["infra"], checklist: [{ text: "Proxmox", done: true }] });
    const [first] = named("Patch the servers");
    expect(first.repeat).toEqual({ every: 1, unit: "week" });
    finish(first);

    const [done, next] = named("Patch the servers").sort((a, b) => a.id - b.id);
    expect(done).toMatchObject({ repeat: null, completed_at: expect.any(Number) });
    expect(next).toMatchObject({ column_id: column(0), due: "2099-01-12", labels: ["infra"], repeat: { every: 1, unit: "week" }, completed_at: null, checklist: [{ text: "Proxmox", done: false }] });

    // Opened again and finished again: the repeat moved on, so nothing more is made.
    updateTask(me, { id: done.id, column: column(0) });
    updateTask(me, { id: done.id, column: column(2) });
    expect(named("Patch the servers")).toHaveLength(2);
  });

  it("makes the next ones when a whole column becomes the finished kind", () => {
    add("Backups", { repeat: { every: 1, unit: "day" } });
    add("Once");
    const middle = column(1);
    for (const t of all()) updateTask(me, { id: t.id, column: middle });
    updateColumn(me, { id: column(2), done: false });
    updateColumn(me, { id: middle, done: true });
    expect(named("Backups").map((t) => [t.column_id, t.completed_at === null])).toEqual(
      expect.arrayContaining([
        [middle, false],
        [column(0), true],
      ]),
    );
    expect(named("Once")).toHaveLength(1);
  });

  it("stops repeating when asked, and refuses nonsense", () => {
    add("Rotate keys", { repeat: { every: 3, unit: "month" } });
    const [t] = named("Rotate keys");
    updateTask(me, { id: t.id, repeat: null });
    finish(t);
    expect(named("Rotate keys")).toHaveLength(1);
    expect(() => add("Bad", { repeat: { every: 0, unit: "week" } })).toThrow(/1 to 365/);
    expect(() => add("Bad", { repeat: { every: 1, unit: "year" } })).toThrow(/day, week or month/);
  });
});

describe("checklists", () => {
  it("keeps items with text, ticked or not", () => {
    add("Set up the NAS", { checklist: [{ text: " Disks ", done: true }, { text: "" }, { text: "Shares", done: "yes" }] });
    expect(named("Set up the NAS")[0].checklist).toEqual([
      { text: "Disks", done: true },
      { text: "Shares", done: false },
    ]);
    expect(() => add("Too much", { checklist: Array.from({ length: 51 }, (_, i) => ({ text: `#${i}` })) })).toThrow(/up to 50/);
    expect(() => add("Not a list", { checklist: "Disks" })).toThrow(/a list/);
  });
});

describe("tasks about a service", () => {
  it("lists one person's open tasks about a service, soonest first", () => {
    add("Renew the certificate", { service: "nas", due: "2099-02-01", checklist: [{ text: "a", done: true }, { text: "b" }] });
    add("Update DSM", { service: "nas", due: "2099-01-01" });
    add("Someday", { service: "nas" });
    add("Other service", { service: "router" });
    add("Not mine", { service: "nas" }, other);
    finish(named("Update DSM")[0]);
    expect(tasksForService(me, "nas").map((t) => [t.title, t.checked, t.checks])).toEqual([
      ["Renew the certificate", 1, 2],
      ["Someday", 0, 0],
    ]);
    expect(named("Renew the certificate")[0].service).toBe("nas");
    expect(() => add("Bad id", { service: "a b" })).toThrow(/No such service/);
  });
});
