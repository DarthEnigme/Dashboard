import { headers } from "next/headers";
import { loadConfig } from "@/lib/config/load";
import { viewerPrefs } from "@/lib/userLook";
import { pickLocale, translator, type Locale, type T } from "./index";

/** The page's language: the viewer's own choice, else the setting; for "auto" the browser's Accept-Language. */
export async function getLocale(): Promise<Locale> {
  const setting = (await viewerPrefs()).language ?? loadConfig().settings.language;
  return pickLocale(setting, setting === "auto" ? (await headers()).get("accept-language") : undefined);
}

export async function getT(): Promise<T> {
  return translator(await getLocale());
}
