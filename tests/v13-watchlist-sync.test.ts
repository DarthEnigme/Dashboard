import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUser } from "@/lib/auth/users";
import { addItem, cleanTags, listItems, tagsAndLists, updateItem } from "@/lib/watchlist/store";
import { applyWatched, findMatch, getSync, parseJellyfinPlayed, parsePlexHistory, setSync } from "@/lib/watchlist/sync";

let user = 0;
beforeEach(() => {
  db().exec("DELETE FROM watch_items; DELETE FROM watch_sync;");
  user ||= createUser({ username: "watcher", role: "user" }).id;
});

describe("watchlist tags and lists", () => {
  it("cleans tags and keeps lists per item", () => {
    expect(cleanTags(" sci-fi, Sci-Fi ,with Sam,, ")).toEqual(["sci-fi", "with Sam"]);
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20);
    addItem(user, { kind: "movie", title: "Dune", tags: ["sci-fi"], list: "Summer 2026" });
    const [dune] = addItem(user, { kind: "book", title: "Piranesi", tags: "fantasy, Sci-fi" }).filter((i) => i.title === "Piranesi");
    expect(dune.tags).toEqual(["fantasy", "Sci-fi"]);
    updateItem(user, dune.id, { list: "Classics", tags: [] });
    const items = listItems(user);
    expect(items.find((i) => i.title === "Piranesi")).toMatchObject({ list: "Classics", tags: [] });
    expect(tagsAndLists(items)).toEqual({ tags: ["sci-fi"], lists: ["Classics", "Summer 2026"] });
  });
});

describe("watchlist sync", () => {
  it("reads Jellyfin and Plex answers", () => {
    expect(
      parseJellyfinPlayed([
        { Id: "a", Name: "Arrival", Type: "Movie", ProductionYear: 2016, ProviderIds: { Tmdb: "329865", Imdb: "tt2543164" }, UserData: { LastPlayedDate: "2026-10-01T20:00:00Z" } },
        { Id: "b", Name: "Severance", Type: "Series" },
      ]),
    ).toEqual([
      { kind: "movie", title: "Arrival", year: 2016, ids: ["tmdb:329865", "imdb:tt2543164", "jellyfin:a"], date: "2026-10-01", complete: true },
      { kind: "show", title: "Severance", year: null, ids: ["jellyfin:b"], date: null, complete: true },
    ]);
    const plex = parsePlexHistory([
      { type: "episode", title: "Good News", grandparentTitle: "Severance", grandparentRatingKey: "9", viewedAt: 1_790_000_000 },
      { type: "episode", title: "Half Loop", grandparentTitle: "Severance", grandparentRatingKey: "9", viewedAt: 1_790_100_000 },
      { type: "movie", title: "Arrival", year: 2016, ratingKey: "3", viewedAt: 1_789_000_000 },
      { type: "track", title: "A song" },
    ]);
    expect(plex).toHaveLength(2);
    expect(plex[0]).toMatchObject({ kind: "show", title: "Severance", complete: false, ids: ["plex:9"] });
    expect(plex[1]).toMatchObject({ kind: "movie", title: "Arrival", year: 2016, complete: true });
  });

  it("matches by id, then by kind, title and year", () => {
    const items = addItem(user, { kind: "movie", title: "arrival", year: 2016 });
    const w = { kind: "movie" as const, title: "Arrival", year: 2016, ids: ["tmdb:1"], date: null, complete: true };
    expect(findMatch(items, w)?.title).toBe("arrival");
    expect(findMatch(items, { ...w, year: 1999 })).toBeUndefined();
    expect(findMatch(items, { ...w, kind: "show" })).toBeUndefined();
  });

  it("finishes, starts and adds, and never moves back", () => {
    addItem(user, { kind: "movie", title: "Arrival", status: "planned" });
    addItem(user, { kind: "show", title: "Severance", status: "planned" });
    const [dropped] = addItem(user, { kind: "movie", title: "Cats" }).filter((i) => i.title === "Cats");
    updateItem(user, dropped.id, { status: "dropped" });
    const r = applyWatched(
      user,
      [
        { kind: "movie", title: "Arrival", year: 2016, ids: ["tmdb:329865"], date: "2026-10-01", complete: true },
        { kind: "show", title: "Severance", year: null, ids: [], date: "2026-10-02", complete: false },
        { kind: "movie", title: "Cats", year: 2019, ids: [], date: null, complete: true },
        { kind: "movie", title: "Heat", year: 1995, ids: ["tmdb:949"], date: "2026-09-30", complete: true },
      ],
      "2026-10-14",
    );
    expect(r).toEqual({ added: 1, updated: 2 });
    const by = Object.fromEntries(listItems(user).map((i) => [i.title, i]));
    expect(by.Arrival).toMatchObject({ status: "done", finished: "2026-10-01" });
    expect(by.Severance.status).toBe("active");
    expect(by.Cats.status).toBe("dropped");
    expect(by.Heat).toMatchObject({ status: "done", finished: "2026-09-30", external_id: "tmdb:949", tags: ["synced"] });
    // Running it again changes nothing.
    expect(applyWatched(user, [{ kind: "movie", title: "Heat", year: 1995, ids: ["tmdb:949"], date: null, complete: true }])).toEqual({ added: 0, updated: 0 });
  });

  it("keeps one link per user", () => {
    setSync(user, "apps.jellyfin", "  Tester ");
    expect(getSync(user)).toMatchObject({ service_id: "apps.jellyfin", media_user: "Tester" });
    setSync(user, null, null);
    expect(getSync(user)).toBeUndefined();
  });
});
