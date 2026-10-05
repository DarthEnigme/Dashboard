import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseHomeAssistant, type HaState } from "@/integrations/homeassistant";
import { parseTruenas } from "@/integrations/truenas";
import { parseSynology } from "@/integrations/synology";
import { calendarResult, icsItems, radarrItems, sonarrItems } from "@/integrations/calendar";
import { age, feedResult, parseFeed } from "@/integrations/rss";
import ha from "./fixtures/homeassistant-states.json";
import tn from "./fixtures/truenas.json";
import syno from "./fixtures/synology.json";

const fixture = (f: string) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const v = (fields: { label: string; value: string | number }[], label: string) => fields.find((f) => f.label === label)?.value;

describe("home assistant", () => {
  it("shows configured entities with units and flags unavailable ones", () => {
    const r = parseHomeAssistant(ha as HaState[], [
      "sensor.living_room_temperature",
      { entity: "binary_sensor.front_door", label: "Door" },
      "sensor.garage",
      "sensor.missing",
    ]);
    expect(r.fields.map((f) => [f.label, f.value, f.status])).toEqual([
      ["Living room", "21.5 °C", undefined],
      ["Door", "off", undefined],
      ["Garage", "unavailable", "warn"],
      ["sensor.missing", "not found", "warn"],
    ]);
  });

  it("summarises the house without configured entities", () => {
    const r = parseHomeAssistant(ha as HaState[], []);
    expect(r.fields.map((f) => f.value)).toEqual([1, 1, 1, 6]);
  });
});

describe("truenas", () => {
  it("reports pool health, active alerts and usage", () => {
    const r = parseTruenas(tn.pools, tn.alerts, 90_000);
    expect(v(r.fields, "Pools")).toBe("1 / 2");
    expect(r.fields[0].status).toBe("error");
    // The critical alert is dismissed: two active, warning level.
    expect(v(r.fields, "Alerts")).toBe(2);
    expect(r.fields[1].status).toBe("warn");
    expect(v(r.fields, "Used")).toBe("69%");
    expect(v(r.fields, "Uptime")).toBe("1d 1h");
    expect(r.list?.[1]).toMatchObject({ label: "fast", status: "error" });
  });
});

describe("synology", () => {
  it("sums CPU load, reports memory, storage and degraded volumes", () => {
    const r = parseSynology(syno.utilization, syno.volumes);
    expect(r.fields.map((f) => f.value)).toEqual(["20%", "81%", "62%", "1 degraded"]);
    expect(r.fields[1].status).toBe("warn");
    expect(r.fields[3].status).toBe("error");
  });
});

describe("calendar", () => {
  const from = new Date("2026-10-03T00:00:00Z");
  const to = new Date("2026-10-31T00:00:00Z");

  it("expands recurring events, honours EXDATE, keeps all-day events and drops old ones", () => {
    const items = icsItems(fixture("calendar.ics"), from, to);
    const football = items.filter((i) => i.title === "Football").map((i) => i.start.toISOString());
    expect(football).toEqual(["2026-10-05T18:00:00.000Z", "2026-10-19T18:00:00.000Z", "2026-10-26T18:00:00.000Z"]);
    // 18:00 Paris time on both sides of the DST change (CEST → CET on Oct 25).
    expect(items.filter((i) => i.title === "Choir").map((i) => i.start.toISOString())).toEqual([
      "2026-10-19T16:00:00.000Z",
      "2026-10-26T17:00:00.000Z",
    ]);
    expect(items.find((i) => i.title === "Bin day")?.allDay).toBe(true);
    expect(items.some((i) => i.title === "Long ago")).toBe(false);
  });

  it("formats sonarr episodes and radarr releases", () => {
    expect(sonarrItems([{ airDateUtc: "2026-10-04T01:00:00Z", seasonNumber: 2, episodeNumber: 5, series: { title: "Severance" } }])[0].title).toBe(
      "Severance S02E05",
    );
    const movies = radarrItems([{ title: "Dune", digitalRelease: "2026-10-10T00:00:00Z", inCinemas: "2026-01-01T00:00:00Z" }], from, to);
    expect(movies.map((m) => m.title)).toEqual(["Dune (digital)"]);
  });

  it("labels upcoming items relative to today", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    const r = calendarResult(
      [
        { start: new Date("2026-10-03T18:00:00Z"), title: "Dinner", allDay: false },
        { start: new Date("2026-10-04T08:00:00Z"), title: "Run", allDay: false },
        { start: new Date("2026-10-08T00:00:00Z"), title: "Trip", allDay: true },
        { start: new Date("2026-10-20T00:00:00Z"), title: "Later", allDay: true },
        { start: new Date("2026-10-02T09:00:00Z"), title: "Past", allDay: false },
      ],
      now,
      "UTC",
    );
    expect(r.list?.map((i) => `${i.label}: ${i.value}`)).toEqual(["Dinner: Today 18:00", "Run: Tomorrow 08:00", "Trip: Thu 8 Oct", "Later: Tue 20 Oct"]);
    expect(r.fields.map((f) => f.value)).toEqual([1, 3]);
    expect(r.compactList).toBe(3);
  });
});

describe("rss", () => {
  it("parses RSS (with CDATA) and Atom (alternate link), newest first", () => {
    const items = [...parseFeed(fixture("feed-rss.xml")), ...parseFeed(fixture("feed-atom.xml"))];
    const r = feedResult(items, 10, Date.parse("2026-10-03T10:00:00Z"));
    expect(r.list).toEqual([
      { label: "New & shiny", value: "1h", href: "https://example.com/new" },
      { label: "v2.0 released", value: "2h", href: "https://example.com/v2" },
      { label: "Older post", value: "24h", href: "https://example.com/old" },
    ]);
  });

  it("rejects non-feeds and formats ages", () => {
    expect(() => parseFeed("<html></html>")).toThrow("Not an RSS or Atom feed");
    expect(age(new Date(0), 3 * 86_400_000)).toBe("3d");
    expect(age(undefined)).toBe("");
  });
});
