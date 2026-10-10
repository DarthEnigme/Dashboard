import { describe, expect, it } from "vitest";
import { gradientPresets, settingsSchema } from "@/lib/config/schema";
import { contrastRatio, gradientColors, lookPresets, paletteThemes } from "@/lib/theme";
import { fontFamily, fontIds, fonts } from "@/lib/fonts";
import { mapColor, resolveMapColors } from "@/lib/travel/colors";
import { nextTrip } from "@/lib/travel/nextTrip";
import type { Trip } from "@/lib/travel/store";
import { parseZones } from "@/info/zones";
import { infoFields } from "@/info/fields";
import { alertChannels, allFields, sections } from "@/components/settings/sections";
import { readFileSync, existsSync } from "node:fs";

const trip = (title: string, start_date: string, end_date: string) => ({ id: 1, title, start_date, end_date, stops: [] }) as unknown as Trip;

describe("travel map colours", () => {
  it("follows the accent unless a colour is set", () => {
    expect(mapColor("accent", "#123456")).toBe("#123456");
    expect(mapColor("", "#123456")).toBe("#123456");
    expect(mapColor(" #ff0000 ", "#123456")).toBe("#ff0000");
    expect(resolveMapColors(undefined, "#abc")).toEqual({ visited: "#abc", lived: "#abc", want: "#f59e0b" });
    expect(resolveMapColors({ lived: "#00ff00" }, "#abc").lived).toBe("#00ff00");
  });

  it("defaults in the settings schema", () => {
    const s = settingsSchema.parse({});
    expect(s.travel).toEqual({ visitedColor: "accent", livedColor: "accent", wantColor: "#f59e0b" });
  });
});

describe("fonts", () => {
  it("defaults to the system font and rejects unknown ones", () => {
    expect(settingsSchema.parse({}).font).toBe("system");
    expect(settingsSchema.safeParse({ font: "comic-sans" }).success).toBe(false);
    expect(fontFamily("system")).toBeUndefined();
    expect(fontFamily("geist")).toBe('"Page Geist"');
  });

  it("has a bundled file and a @font-face for every font", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    for (const id of fontIds) {
      const family = fonts[id].family;
      if (!family) continue;
      expect(css).toContain(`font-family: "${family}"`);
    }
    for (const m of css.matchAll(/url\("\/fonts\/([^"]+)"\)/g)) expect(existsSync(`public/fonts/${m[1]}`)).toBe(true);
  });
});

describe("Discord themes", () => {
  it("has readable palettes", () => {
    for (const id of ["discord-dark", "discord-ash", "discord-onyx", "discord-light"]) {
      const p = paletteThemes[id];
      expect(p).toBeDefined();
      expect(contrastRatio(p.colors.fg, p.colors.page)).toBeGreaterThan(7);
      expect(contrastRatio(p.colors.fg, p.colors.surface)).toBeGreaterThan(7);
      expect(settingsSchema.safeParse({ theme: id }).success).toBe(true);
    }
  });

  it("lists every gradient and points every look at a known theme and gradient", () => {
    expect([...gradientPresets].sort()).toEqual(Object.keys(gradientColors).sort());
    for (const l of lookPresets) {
      expect(gradientColors[l.gradient], l.id).toBeDefined();
      if (l.theme) expect(settingsSchema.safeParse({ theme: l.theme }).success, l.id).toBe(true);
    }
    expect(new Set(lookPresets.map((l) => l.id)).size).toBe(lookPresets.length);
  });
});

describe("alert channels in settings", () => {
  it("shows every alert key once, and search still finds them", () => {
    const monitoring = sections.find((s) => s.id === "monitoring")!;
    const channelKeys = alertChannels.flatMap((c) => c.fields.map((f) => f.key));
    expect(new Set(channelKeys).size).toBe(channelKeys.length);
    expect(monitoring.fields.some((f) => channelKeys.includes(f.key))).toBe(false);
    expect(monitoring.extraKeys).toEqual(channelKeys);
    const all = allFields(monitoring).map((f) => f.key);
    for (const k of ["alerts.discord", "alerts.gotifyToken", "alerts.email.host", "alerts.messages.down", "alerts.threshold"]) expect(all).toContain(k);
  });
});

describe("info widgets", () => {
  it("has editor entries for the new widgets", () => {
    for (const type of ["clock", "trip", "status", "finance"]) expect(infoFields[type]).toBeDefined();
  });

  it("reads time zones with or without a label, dropping unknown ones", () => {
    expect(parseZones("Tokyo=Asia/Tokyo, America/New_York, Nowhere/Land")).toEqual([
      { label: "Tokyo", zone: "Asia/Tokyo" },
      { label: "New York", zone: "America/New_York" },
    ]);
    expect(parseZones(["UTC"])).toEqual([{ label: "UTC", zone: "UTC" }]);
    expect(parseZones(undefined)).toEqual([]);
  });

  it("picks the trip under way, else the next one", () => {
    const trips = [trip("Past", "2026-01-01", "2026-01-05"), trip("Tokyo", "2026-11-03", "2026-11-12"), trip("Rome", "2026-12-20", "2026-12-24")];
    expect(nextTrip(trips, "2026-10-11")).toMatchObject({ ongoing: false, inDays: 23, trip: { title: "Tokyo" } });
    expect(nextTrip(trips, "2026-11-06")).toMatchObject({ ongoing: true, day: 4, length: 10, trip: { title: "Tokyo" } });
    expect(nextTrip(trips, "2027-01-01")).toBeNull();
  });
});
