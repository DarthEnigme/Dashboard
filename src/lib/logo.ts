import crypto from "node:crypto";
import { readUpload } from "./uploads";

/** Short version of what the app icon is drawn from, so a new logo gets a new icon URL (caches keep the old one). */
export const iconVersion = (s: { logo?: string; title: string; accent: string }) =>
  crypto.createHash("sha1").update(`${s.logo ?? ""}|${s.title}|${s.accent}`).digest("hex").slice(0, 8);

/**
 * The logo as something the icon renderer can draw: uploads are inlined as a data URL, other URLs are
 * fetched by the renderer. Only PNG and JPEG can be drawn into an icon; anything else falls back to
 * the title's first letter.
 */
export function iconLogo(logo: string | undefined): string | undefined {
  if (!logo) return undefined;
  const m = /^\/api\/uploads\/([a-z]+)\/([^/?#]+)$/.exec(logo);
  if (m) {
    const file = readUpload(m[1], m[2]);
    return file && /png|jpeg/.test(file.type) ? `data:${file.type};base64,${file.data.toString("base64")}` : undefined;
  }
  return /^https?:\/\/.+\.(png|jpe?g)(\?.*)?$/i.test(logo) ? logo : undefined;
}
