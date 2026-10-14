import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { requireUser, sameOrigin } from "@/lib/auth";
import * as users from "@/lib/auth/users";
import { userPrefsSchema, type UserPrefs } from "@/lib/config/schema";
import { removeUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** What the global look is, for "Default (…)" in the pickers, and the custom themes one may pick. */
function defaults() {
  const s = loadConfig().settings;
  return {
    language: s.language,
    theme: s.theme,
    style: s.style,
    accent: s.accent,
    glow: s.glow,
    font: s.font,
    background: s.background,
    customThemes: s.customThemes,
  };
}

/** Your own look, and the global one it falls back to. */
export async function GET() {
  const me = await requireUser();
  if (!me) return err("Sign in first", 401);
  return NextResponse.json({ prefs: users.getPrefs(me.id), defaults: defaults() });
}

/**
 * Change your own look: { theme?, style?, accent?, glow?, font?, language?, background?: { gradient?, blur?, brightness? } }.
 * null puts a field back to the global setting; { reset: true } puts all of them back. The wallpaper
 * itself goes through /api/profile/background.
 */
export async function PATCH(req: Request) {
  const me = await requireUser();
  if (!me) return err("Sign in first", 401);
  if (!sameOrigin(req)) return err("Cross-site request refused", 403);
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const current = users.getPrefs(me.id);

  if (b.reset === true) {
    removeUpload(current.background?.image);
    users.setPrefs(me.id, {});
    return NextResponse.json({ prefs: {}, defaults: defaults() });
  }

  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(b)) {
    if (k === "background") continue;
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  if (b.background !== undefined) {
    const bg: Record<string, unknown> = { ...current.background };
    const patch = (b.background ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (k === "image") continue; // only through the upload route
      if (v === null) delete bg[k];
      else bg[k] = v;
    }
    if (b.background === null) for (const k of Object.keys(bg)) if (k !== "image") delete bg[k];
    if (Object.keys(bg).length) merged.background = bg;
    else delete merged.background;
  }

  const parsed = userPrefsSchema.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`${issue.path.join(".") || "prefs"}: ${issue.message}`);
  }
  const prefs: UserPrefs = parsed.data;
  users.setPrefs(me.id, prefs);
  return NextResponse.json({ prefs, defaults: defaults() });
}
