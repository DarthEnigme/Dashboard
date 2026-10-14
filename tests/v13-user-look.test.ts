import { describe, expect, it } from "vitest";
import { settingsSchema, userPrefsSchema } from "@/lib/config/schema";
import { createUser, getPrefs, setPrefs } from "@/lib/auth/users";
import { withPrefs } from "@/lib/userLook";

const global = settingsSchema.parse({
  theme: "dark",
  accent: "#8b5cf6",
  background: { image: "/api/uploads/backgrounds/global.jpg", gradient: "aurora" },
  customThemes: [{ id: "mine", label: "Mine", colors: { page: "#000000", surface: "#111111", fg: "#ffffff" } }],
});

describe("per-user look", () => {
  it("follows the global look for anything left unset", () => {
    expect(withPrefs(global, {})).toBe(global);
    const s = withPrefs(global, { theme: "nord", accent: "auto", font: "inter" });
    expect(s).toMatchObject({ theme: "nord", accent: "auto", font: "inter", style: global.style, glow: global.glow });
    expect(s.background).toEqual(global.background);
  });

  it("puts the user's wallpaper over the global one; their gradient drops the global wallpaper", () => {
    expect(withPrefs(global, { background: { image: "/api/uploads/backgrounds/mine.jpg" } }).background.image).toBe("/api/uploads/backgrounds/mine.jpg");
    const g = withPrefs(global, { background: { gradient: "ocean", blur: 4 } }).background;
    expect(g).toMatchObject({ gradient: "ocean", blur: 4, image: undefined, brightness: global.background.brightness });
    // Both: the wallpaper wins.
    expect(withPrefs(global, { background: { gradient: "ocean", image: "/api/uploads/backgrounds/mine.jpg" } }).background.image).toBe("/api/uploads/backgrounds/mine.jpg");
  });

  it("drops a custom theme that no longer exists", () => {
    expect(withPrefs(global, { theme: "custom:mine" }).theme).toBe("custom:mine");
    expect(withPrefs(global, { theme: "custom:gone" }).theme).toBe("dark");
  });

  it("only accepts known values and own uploads", () => {
    expect(userPrefsSchema.safeParse({ theme: "dracula", style: "neon", glow: 30, language: "fr" }).success).toBe(true);
    expect(userPrefsSchema.safeParse({ theme: "nope" }).success).toBe(false);
    expect(userPrefsSchema.safeParse({ accent: "red" }).success).toBe(false);
    expect(userPrefsSchema.safeParse({ background: { image: "https://example.com/x.jpg" } }).success).toBe(false);
    // Global-only settings are not personal.
    expect(userPrefsSchema.safeParse({ title: "Mine" }).success).toBe(false);
  });

  it("stores prefs per user", () => {
    const a = createUser({ username: "look-a", role: "user" });
    const b = createUser({ username: "look-b", role: "user" });
    setPrefs(a.id, { theme: "nord", background: { gradient: "ocean" } });
    expect(getPrefs(a.id)).toEqual({ theme: "nord", background: { gradient: "ocean" } });
    expect(getPrefs(b.id)).toEqual({});
    setPrefs(a.id, {});
    expect(getPrefs(a.id)).toEqual({});
  });
});
