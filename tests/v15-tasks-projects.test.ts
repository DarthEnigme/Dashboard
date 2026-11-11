import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { CONFIG_DIR } from "@/lib/config/load";
import { createsCycle, steps } from "@/lib/tasks/graph";
import { addLane, addTask, deleteLane, loadBoard, taskReminderJob, tasksSummary, updateBoard, updateColumn, updateLane, updateTask, type BoardNames } from "@/lib/tasks/store";

const user = (name: string) => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, 'user', ?)").run(name, Date.now()).lastInsertRowid);
const NAMES: BoardNames = { board: "My board", columns: ["To do", "In progress", "Done"] };
let me = 0;
let other = 0;

beforeEach(() => {
  db().exec("DELETE FROM task_boards; DELETE FROM users; DELETE FROM app_meta WHERE key LIKE 'task-%';");
  me = user("me");
  other = user("other");
});

const board = (userId = me) => loadBoard(userId, undefined, NAMES).board;
const task = (title: string, userId = me) => board(userId).columns.flatMap((c) => c.tasks).find((t) => t.title === title)!;
const add = (title: string, extra: Record<string, unknown> = {}) => addTask(me, { column: board().columns[0].id, title, ...extra });

describe("the waits-for graph", () => {
  it("finds loops", () => {
    const waits = new Map([
      [2, [1]],
      [3, [2]],
    ]);
    expect(createsCycle(waits, 1, [3])).toBe(true);
    expect(createsCycle(waits, 4, [3])).toBe(false);
    expect(createsCycle(waits, 1, [1])).toBe(true);
  });

  it("puts tasks in steps, each after what it waits for", () => {
    const t = (id: number, blocked_by: number[] = []) => ({ id, blocked_by });
    expect(steps([t(3, [2]), t(1), t(2, [1]), t(4, [1]), t(5, [99])]).map((s) => s.map((x) => x.id))).toEqual([[1, 5], [2, 4], [3]]);
  });
});

describe("project boards", () => {
  it("turns project mode and reminders on and off", () => {
    updateBoard(me, { id: board().id, project: true, notify: true });
    expect(board()).toMatchObject({ project: true, notify: true });
    expect(() => updateBoard(other, { id: board().id, project: false })).toThrow(/No such board/);
  });

  it("keeps a waiting task from being finished until what it waits for is", () => {
    addTask(me, { column: board().columns[1].id, title: "Design" });
    add("Build", { blocked_by: [task("Design").id] });
    const done = board().columns[2];
    expect(task("Build")).toMatchObject({ blocked: true, blocked_by: [task("Design").id] });
    expect(() => updateTask(me, { id: task("Build").id, column: done.id })).toThrow(/waits for/);
    // Nor by making its column the "done" kind.
    expect(() => updateColumn(me, { id: board().columns[0].id, done: true })).toThrow(/waits for/);
    expect(board().columns[0].done).toBe(false);

    updateTask(me, { id: task("Design").id, column: done.id });
    expect(task("Build").blocked).toBe(false);
    updateTask(me, { id: task("Build").id, column: done.id });
    expect(task("Build").completed_at).not.toBeNull();
  });

  it("refuses waits on itself, in a loop, or on another board", () => {
    add("A");
    add("B", { blocked_by: [task("A").id] });
    expect(() => updateTask(me, { id: task("A").id, blocked_by: [task("A").id] })).toThrow(/itself/);
    expect(() => updateTask(me, { id: task("A").id, blocked_by: [task("B").id] })).toThrow(/loop/);
    addTask(other, { column: board(other).columns[0].id, title: "Theirs" });
    expect(() => updateTask(me, { id: task("A").id, blocked_by: [task("Theirs", other).id] })).toThrow(/on its board/);
    // A finished task can't start waiting for an open one.
    updateTask(me, { id: task("A").id, column: board().columns[2].id });
    add("C");
    expect(() => updateTask(me, { id: task("A").id, blocked_by: [task("C").id] })).toThrow(/waits for/);
  });

  it("still lets a finished task be edited after what it waits for opens again", () => {
    const done = () => board().columns[2].id;
    add("Design");
    add("Build", { blocked_by: [task("Design").id] });
    updateTask(me, { id: task("Design").id, column: done() });
    updateTask(me, { id: task("Build").id, column: done() });
    // Design goes back to work; Build stays finished and can still be renamed, with the same blockers sent.
    updateTask(me, { id: task("Design").id, column: board().columns[0].id });
    updateTask(me, { id: task("Build").id, title: "Build v2", blocked_by: [task("Design").id] });
    expect(task("Build v2").completed_at).not.toBeNull();
    // Moving it to another lane in its column is not finishing it again either.
    addLane(me, { board: board().id, name: "Later" });
    updateTask(me, { id: task("Build v2").id, lane: board().lanes[0].id });
  });

  it("finishes a column's tasks together when they wait on each other there, whatever their order", () => {
    add("Build");
    add("Design");
    updateTask(me, { id: task("Build").id, blocked_by: [task("Design").id] });
    updateColumn(me, { id: board().columns[0].id, done: true });
    expect(board().columns[0].tasks.every((t) => t.completed_at !== null)).toBe(true);
    updateColumn(me, { id: board().columns[0].id, done: false });
    expect(board().columns[0].tasks.every((t) => t.completed_at === null)).toBe(true);
  });

  it("keeps a task's place when it is saved in the same column", () => {
    for (const title of ["one", "two", "three"]) add(title);
    updateTask(me, { id: task("one").id, column: board().columns[0].id, title: "first" });
    expect(board().columns[0].tasks.map((t) => t.title)).toEqual(["first", "two", "three"]);
  });
});

describe("lanes", () => {
  it("groups tasks in rows, ordered, private, and keeps them when a lane goes", () => {
    addLane(me, { board: board().id, name: "Home" });
    addLane(me, { board: board().id, name: "Work" });
    const [home, work] = board().lanes;
    add("Paint", { lane: home.id });
    add("Report", { lane: work.id });
    add("Loose");
    expect(board().columns[0].tasks.map((t) => [t.title, t.lane_id])).toEqual([
      ["Paint", home.id],
      ["Report", work.id],
      ["Loose", null],
    ]);

    // Moved to another lane and column, first in that cell.
    updateTask(me, { id: task("Paint").id, column: board().columns[1].id, lane: work.id, index: 0 });
    expect(task("Paint")).toMatchObject({ lane_id: work.id, column_id: board().columns[1].id });

    updateLane(me, { id: work.id, index: 0, collapsed: true });
    expect(board().lanes.map((l) => [l.name, l.collapsed])).toEqual([
      ["Work", true],
      ["Home", false],
    ]);
    expect(() => addLane(other, { board: board().id, name: "Sneaky" })).toThrow(/No such board/);
    expect(() => updateTask(me, { id: task("Loose").id, lane: 999_999 })).toThrow(/No such lane/);

    deleteLane(me, work.id);
    expect(task("Report").lane_id).toBeNull();
    expect(board().lanes.map((l) => l.name)).toEqual(["Home"]);
  });
});

describe("reminders", () => {
  let server: http.Server;
  const hooks: { kind: string; message: string; level: string }[] = [];
  const settings = path.join(CONFIG_DIR, "settings.yaml");
  let before: string | undefined;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        hooks.push(JSON.parse(b));
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    before = fs.existsSync(settings) ? fs.readFileSync(settings, "utf8") : undefined;
    fs.writeFileSync(settings, `title: Test\nalerts:\n  webhook: http://127.0.0.1:${(server.address() as AddressInfo).port}/hook\ntasks:\n  dueSoonDays: 2\n`);
  });
  afterAll(() => {
    server.close();
    if (before === undefined) fs.rmSync(settings, { force: true });
    else fs.writeFileSync(settings, before);
  });
  beforeEach(() => void (hooks.length = 0));

  const now = new Date("2026-11-11T12:00:00Z");

  it("sums up what is overdue and due soon", () => {
    add("Late", { due: "2026-11-01" });
    add("Soon", { due: "2026-11-13" });
    add("Later", { due: "2026-12-01" });
    add("Undated");
    const s = tasksSummary(me, 2, now);
    expect(s).toMatchObject({ open: 4, overdue: 1 });
    expect(s.due.map((d) => [d.title, d.overdue])).toEqual([
      ["Late", true],
      ["Soon", false],
    ]);
    expect(tasksSummary(other, 2, now).due).toEqual([]);
  });

  it("tells the alert channels once, only for boards that ask", async () => {
    add("Late", { due: "2026-11-01" });
    add("Soon", { due: "2026-11-12" });
    await taskReminderJob(now);
    expect(hooks).toEqual([]);

    updateBoard(me, { id: board().id, notify: true });
    await taskReminderJob(now);
    await taskReminderJob(now);
    expect(hooks.map((h) => [h.kind, h.level, h.message])).toEqual([
      ["task", "warn", "The task “Late” (My board) is overdue: it was due 2026-11-01."],
      ["task", "info", "The task “Soon” (My board) is due tomorrow (2026-11-12)."],
    ]);
  });
});
