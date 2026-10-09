import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { COUNTRIES, countryIndex, countryName, DOTS, flag } from "@/lib/travel/geo";
import { createTrip, deletePlace, deleteTrip, listPlaces, listTrips, savePlace, travelStats, updateTrip, visitedCountries } from "@/lib/travel/store";

const user = (name: string) => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, 'user', ?)").run(name, Date.now()).lastInsertRowid);
let me = 0;
let friend = 0;

beforeEach(() => {
  db().exec("DELETE FROM travel_places; DELETE FROM travel_trips; DELETE FROM users;");
  me = user("me");
  friend = user("friend");
});

describe("travel geography", () => {
  it("knows the countries, their names in French, and tags land dots correctly", () => {
    expect(COUNTRIES.length).toBe(250);
    expect(countryName("DE", "fr")).toBe("Allemagne");
    expect(countryName("DE")).toBe("Germany");
    expect(flag("FR")).toBe("🇫🇷");
    // The 195 "countries of the world": UN members and the two observers (the Vatican, Palestine).
    expect(COUNTRIES.filter((c) => c.un || c.code === "PS" || c.code === "VA").length).toBe(195);
    // A dot near Paris belongs to France; one near Tokyo to Japan.
    const near = (lon: number, lat: number) => {
      let best = -1;
      let d = Infinity;
      for (let i = 0; i < DOTS.length; i += 3) {
        const dd = (DOTS[i] / 10 - lon) ** 2 + (DOTS[i + 1] / 10 - lat) ** 2;
        if (dd < d) (d = dd), (best = DOTS[i + 2]);
      }
      return COUNTRIES[best].code;
    };
    expect(near(2.35, 46.8)).toBe("FR");
    expect(near(139.7, 36)).toBe("JP");
    expect(near(-100, 40)).toBe("US");
    expect(DOTS.length / 3).toBeGreaterThan(5000);
  });
});

describe("travel log", () => {
  it("marks places, one per country and city", () => {
    savePlace(me, { country: "pt", status: "want" });
    savePlace(me, { country: "PT", status: "visited" });
    savePlace(me, { country: "PT", city: "Lisbon", lat: 38.7, lon: -9.1 });
    const list = listPlaces(me);
    expect(list.map((p) => [p.country, p.city, p.status])).toEqual([
      ["PT", null, "visited"],
      ["PT", "Lisbon", "visited"],
    ]);
    expect(() => savePlace(me, { country: "XX" })).toThrow(/Unknown country/);
    deletePlace(me, list[0].id);
    expect(listPlaces(me)).toHaveLength(1);
    expect(listPlaces(friend)).toHaveLength(0);
  });

  it("shares trips with companions, who can't edit them but can leave", () => {
    const trip = { title: "Japan", start_date: "2025-04-01", end_date: "2025-04-10", stops: [{ country: "JP", city: "Kyoto", lat: 35, lon: 135.8 }], companions: [friend], rating: 5 };
    const [t] = createTrip(me, trip);
    const theirs = listTrips(friend);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ title: "Japan", mine: false, owner: "me" });
    expect(() => updateTrip(friend, t.id, { ...trip, title: "Mine now" })).toThrow(/Only the person/);
    deleteTrip(friend, t.id); // leaves it
    expect(listTrips(friend)).toHaveLength(0);
    expect(listTrips(me)[0].companions).toEqual([]);
    expect(() => createTrip(me, { ...trip, end_date: "2025-03-01" })).toThrow(/ends before/);
  });

  it("counts countries, continents, cities and days away", () => {
    savePlace(me, { country: "FR", status: "lived" });
    savePlace(me, { country: "IS", status: "want" });
    savePlace(me, { country: "GL", status: "visited" }); // Greenland: not one of the 195
    createTrip(me, { title: "Portugal", start_date: "2025-12-30", end_date: "2026-01-02", stops: [{ country: "PT", city: "Lisbon" }, { country: "PT", city: "Porto" }] });
    createTrip(me, { title: "Japan", start_date: "2026-04-01", end_date: "2026-04-10", stops: [{ country: "JP", city: "Kyoto" }] });
    createTrip(me, { title: "Future", start_date: "2027-01-01", end_date: "2027-01-05", stops: [{ country: "BR" }] });
    const places = listPlaces(me);
    const trips = listTrips(me);
    expect([...visitedCountries(places, trips, "2026-10-09")].sort()).toEqual(["FR", "GL", "JP", "PT"]);
    const s = travelStats(places, trips, "2026-10-09");
    // Greenland counts for North America, not for the 195.
    expect(s).toMatchObject({ countries: 3, of: 195, continents: 3, cities: 3, trips: 2, longest: { title: "Japan", days: 10 } });
    expect(s.daysByYear).toEqual([
      { year: "2026", days: 12 },
      { year: "2025", days: 2 },
    ]);
  });
});
