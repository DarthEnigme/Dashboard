import { headers } from "next/headers";
import { loadConfig } from "@/lib/config/load";
import { pickLocale, translator, type Locale, type T } from "./index";

/** The page's language: the setting, or for "auto" the browser's Accept-Language. */
export async function getLocale(): Promise<Locale> {
  const setting = loadConfig().settings.language;
  return pickLocale(setting, setting === "auto" ? (await headers()).get("accept-language") : undefined);
}

export async function getT(): Promise<T> {
  return translator(await getLocale());
}
