import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addItem, deleteItem, listItems, parseOpenLibrary, updateItem, watchStats } from "@/lib/watchlist/store";

const user = (name: string) => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, 'user', ?)").run(name, Date.now()).lastInsertRowid);
let me = 0;
let other = 0;
const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  db().exec("DELETE FROM watch_items; DELETE FROM users;");
  me = user("me");
  other = user("other");
});

describe("watchlist", () => {
  it("keeps each person's list private", () => {
    addItem(me, { kind: "movie", title: "Arrival", creator: "Denis Villeneuve", year: 2016 });
    expect(listItems(me)).toHaveLength(1);
    expect(listItems(other)).toHaveLength(0);
    const id = listItems(me)[0].id;
    expect(() => updateItem(other, id, { title: "Mine" })).toThrow(/No such item/);
    deleteItem(other, id);
    expect(listItems(me)).toHaveLength(1);
    expect(() => addItem(me, { title: "  " })).toThrow(/Title required/);
  });

  it("starts, finishes and resets dates as the status changes", () => {
    const [book] = addItem(me, { kind: "book", title: "Dune", total: 612 });
    expect(book).toMatchObject({ status: "planned", started: null, finished: null });
    let [b] = updateItem(me, book.id, { status: "active", progress: 100 });
    expect(b).toMatchObject({ status: "active", started: today, progress: 100 });
    [b] = updateItem(me, book.id, { progress: 9999 });
    expect(b.progress).toBe(612); // never past the total
    [b] = updateItem(me, book.id, { status: "done", rating: 5 });
    expect(b).toMatchObject({ status: "done", finished: today, progress: 612, rating: 5 });
    [b] = updateItem(me, book.id, { status: "planned" });
    expect(b).toMatchObject({ started: null, finished: null });
    [b] = updateItem(me, book.id, { rating: 9, cover: "javascript:alert(1)" });
    expect(b.rating).toBeNull();
    expect(b.cover).toBeNull();
  });

  it("counts what you finished this year and the pages read", () => {
    const year = today.slice(0, 4);
    addItem(me, { kind: "book", title: "A", total: 300, status: "done" });
    addItem(me, { kind: "book", title: "B", total: 200, status: "done" });
    addItem(me, { kind: "movie", title: "C", status: "done" });
    addItem(me, { kind: "show", title: "D", status: "active" });
    addItem(me, { kind: "game", title: "E" });
    const s = watchStats(listItems(me), year);
    expect(s).toEqual({ year, done: { book: 2, movie: 1 }, pages: 500, active: 1, planned: 1 });
    expect(watchStats(listItems(me), "1999").done).toEqual({});
  });

  it("reads Open Library search results", () => {
    const hits = parseOpenLibrary(
      { docs: [{ key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert", "B", "C"], first_publish_year: 1965, number_of_pages_median: 612, cover_i: 42 }, { key: "/works/OL2W", title: "No cover" }] },
      "https://covers.example",
    );
    expect(hits).toEqual([
      { title: "Dune", author: "Frank Herbert, B", year: 1965, pages: 612, cover: "https://covers.example/b/id/42-M.jpg", key: "/works/OL1W" },
      { title: "No cover", author: null, year: null, pages: null, cover: null, key: "/works/OL2W" },
    ]);
  });
});
