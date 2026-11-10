import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { APPS, PERMISSIONS } from "@/lib/config/schema";
import { MODULE_TABLES } from "@/lib/modules";
import { APP_SECTIONS, PERMISSION_BLURBS } from "@/lib/sections";
import { addColumn, addTask, createBoard, deleteBoard, deleteColumn, deleteTask, loadBoard, renameBoard, updateColumn, updateTask, type BoardNames } from "@/lib/tasks/store";

const user = (name: string) => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, 'user', ?)").run(name, Date.now()).lastInsertRowid);
const NAMES: BoardNames = { board: "My board", columns: ["To do", "In progress", "Done"] };
let me = 0;
let other = 0;

beforeEach(() => {
  db().exec("DELETE FROM task_boards; DELETE FROM users;");
  me = user("me");
  other = user("other");
});

const board = (userId = me, id?: number) => loadBoard(userId, id, NAMES).board;
const titles = (userId = me) => board(userId).columns.map((c) => c.tasks.map((t) => t.title));

describe("the app table", () => {
  it("describes every app once, everywhere it is needed", () => {
    expect(APP_SECTIONS.map((s) => s.id).sort()).toEqual([...APPS].sort());
    expect(Object.keys(MODULE_TABLES).sort()).toEqual([...APPS].sort());
    expect(Object.keys(PERMISSION_BLURBS).sort()).toEqual([...PERMISSIONS].sort());
    for (const s of APP_SECTIONS) expect(s).toMatchObject({ href: `/${s.id}`, permission: s.id });
    // Every table an app owns exists.
    for (const t of Object.values(MODULE_TABLES).flat()) expect(() => db().prepare(`SELECT 1 FROM ${t} LIMIT 1`).get()).not.toThrow();
  });
});

describe("task boards", () => {
  it("gives a first board with the three usual columns, the last one for finished tasks", () => {
    const b = board();
    expect(b.name).toBe("My board");
    expect(b.columns.map((c) => [c.name, c.done])).toEqual([
      ["To do", false],
      ["In progress", false],
      ["Done", true],
    ]);
    // Asking again doesn't make a second one.
    expect(loadBoard(me, undefined, NAMES).boards).toHaveLength(1);
  });

  it("keeps each person's boards private", () => {
    const [todo] = board().columns;
    addTask(me, { column: todo.id, title: "Mine" });
    const task = board().columns[0].tasks[0];
    expect(titles(other)).toEqual([[], [], []]);
    expect(() => addTask(other, { column: todo.id, title: "Sneaky" })).toThrow(/No such column/);
    expect(() => updateTask(other, { id: task.id, title: "Theirs" })).toThrow(/No such task/);
    expect(() => deleteTask(other, task.id)).toThrow(/No such task/);
    expect(() => renameBoard(other, board().id, { name: "Theirs" })).toThrow(/No such board/);
    expect(() => deleteColumn(other, todo.id)).toThrow(/No such column/);
    // Someone else's board id shows your own first board instead.
    expect(board(other, board().id).id).not.toBe(board().id);
    expect(titles()).toEqual([["Mine"], [], []]);
  });

  it("adds tasks last, cleans their fields and refuses bad ones", () => {
    const [todo] = board().columns;
    addTask(me, { column: todo.id, title: "  Buy milk ", priority: 2, due: "2026-12-01", labels: "home, Home, errands", body: "2 litres" });
    addTask(me, { column: todo.id, title: "Second" });
    const [first, second] = board().columns[0].tasks;
    expect(first).toMatchObject({ title: "Buy milk", priority: 2, due: "2026-12-01", labels: ["home", "errands"], body: "2 litres", completed_at: null });
    expect(second).toMatchObject({ title: "Second", priority: 0, due: null, labels: [] });
    expect(loadBoard(me, undefined, NAMES).labels).toEqual(["errands", "home"]);
    expect(() => addTask(me, { column: todo.id, title: " " })).toThrow(/Title required/);
    expect(() => addTask(me, { column: todo.id, title: "x", priority: 9 })).toThrow(/Priority/);
    expect(() => addTask(me, { column: todo.id, title: "x", due: "tomorrow" })).toThrow(/due date/);
    updateTask(me, { id: first.id, due: null, labels: [] });
    expect(board().columns[0].tasks[0]).toMatchObject({ title: "Buy milk", due: null, labels: [] });
  });

  it("moves tasks within and between columns, keeping the order", () => {
    const [todo, doing, done] = board().columns;
    for (const title of ["a", "b", "c", "d"]) addTask(me, { column: todo.id, title });
    const id = (title: string) =>
      board()
        .columns.flatMap((c) => c.tasks)
        .find((t) => t.title === title)!.id;

    updateTask(me, { id: id("d"), index: 0 });
    expect(titles()).toEqual([["d", "a", "b", "c"], [], []]);
    updateTask(me, { id: id("a"), index: 3 });
    expect(titles()).toEqual([["d", "b", "c", "a"], [], []]);
    updateTask(me, { id: id("b"), column: doing.id });
    updateTask(me, { id: id("c"), column: doing.id, index: 0 });
    expect(titles()).toEqual([["d", "a"], ["c", "b"], []]);
    // A new task goes after what is left, also when earlier positions were freed.
    addTask(me, { column: todo.id, title: "e" });
    expect(titles()[0]).toEqual(["d", "a", "e"]);

    // Reaching a "done" column finishes a task; leaving it opens it again.
    updateTask(me, { id: id("c"), column: done.id });
    const finished = board().columns[2].tasks[0];
    expect(finished.completed_at).toBeTypeOf("number");
    updateTask(me, { id: id("c"), column: todo.id, index: 1 });
    expect(titles()).toEqual([["d", "c", "a", "e"], ["b"], []]);
    expect(board().columns[0].tasks[1].completed_at).toBeNull();

    // A task doesn't leave its board.
    const second = createBoard(me, { name: "Work" }, NAMES);
    const elsewhere = board(me, second).columns[0];
    expect(() => updateTask(me, { id: id("a"), column: elsewhere.id })).toThrow(/stays on its board/);
  });

  it("renames, reorders, marks and deletes columns", () => {
    const b = board();
    addColumn(me, { board: b.id, name: "Review" });
    const review = board().columns[3];
    updateColumn(me, { id: review.id, index: 2, name: "In review" });
    expect(board().columns.map((c) => c.name)).toEqual(["To do", "In progress", "In review", "Done"]);

    addTask(me, { column: review.id, title: "PR" });
    expect(() => deleteColumn(me, review.id)).toThrow(/tasks first/);
    updateColumn(me, { id: review.id, done: true });
    expect(board().columns[2].tasks[0].completed_at).toBeTypeOf("number");
    updateColumn(me, { id: review.id, done: false });
    expect(board().columns[2].tasks[0].completed_at).toBeNull();

    deleteTask(me, board().columns[2].tasks[0].id);
    deleteColumn(me, review.id);
    addColumn(me, { board: b.id, name: "Later" });
    expect(board().columns.map((c) => c.name)).toEqual(["To do", "In progress", "Done", "Later"]);
    expect(() => addColumn(me, { board: b.id, name: "" })).toThrow(/Name required/);
  });

  it("keeps several boards, and deletes one with everything on it", () => {
    const first = board();
    const work = createBoard(me, { name: "Work" }, NAMES);
    addTask(me, { column: board(me, work).columns[0].id, title: "Ship it" });
    renameBoard(me, work, { name: "Job" });
    expect(loadBoard(me, work, NAMES).boards.map((x) => x.name)).toEqual(["My board", "Job"]);
    deleteBoard(me, work);
    expect(loadBoard(me, work, NAMES).board.id).toBe(first.id);
    expect(db().prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  });
});
