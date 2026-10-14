import { cache } from "react";
import { viewer } from "./auth";
import { getPrefs } from "./auth/users";
import type { Settings, UserPrefs } from "./config/schema";

type Look = Pick<Settings, "language" | "theme" | "style" | "accent" | "glow" | "font" | "background" | "customThemes">;

/** Lay a user's own look over the global settings; anything they left unset follows the global one. */
export function withPrefs<S extends Look>(settings: S, prefs: UserPrefs | undefined): S {
  if (!prefs || !Object.keys(prefs).length) return settings;
  const { background, ...rest } = prefs;
  // A theme naming a custom theme that is gone falls back to the global one.
  const theme = rest.theme?.startsWith("custom:") && !settings.customThemes.some((t) => `custom:${t.id}` === rest.theme) ? undefined : rest.theme;
  const out = { ...settings, ...rest, theme: theme ?? settings.theme };
  if (background) {
    // Picking a gradient means "no wallpaper": theirs, and also the global one.
    const image = background.image ?? (background.gradient ? undefined : settings.background.image);
    out.background = { ...settings.background, ...background, image };
  }
  return out;
}

/** The signed-in viewer's own look, once per request (empty when signed out). */
export const viewerPrefs = cache(async (): Promise<UserPrefs> => {
  const v = await viewer();
  return v.user ? getPrefs(v.user.id) : {};
});

/** The settings as this viewer sees them: the global look with theirs on top. */
export async function personal<S extends Look>(settings: S): Promise<S> {
  return withPrefs(settings, await viewerPrefs());
}
