import { fr } from "./fr";

/**
 * Translations. English text is the key (`t("Filter services…")`), so the code reads as the
 * English UI and anything without a translation falls back to English. `{name}` placeholders are
 * filled from `vars`. Client- and server-safe.
 */
export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

const dictionaries: Record<Locale, Record<string, string>> = { en: {}, fr };

export type Vars = Record<string, string | number>;
export type T = ((key: string, vars?: Vars) => string) & {
  /** `{n}` picks the singular or plural key by count (one = 1, also 0 in French). */
  plural: (n: number, one: string, other: string, vars?: Vars) => string;
  locale: Locale;
};

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

export function translator(locale: Locale): T {
  const dict = dictionaries[locale] ?? {};
  const t = ((key: string, vars?: Vars) => fill(dict[key] ?? key, vars)) as T;
  t.plural = (n, one, other, vars) => t(new Intl.PluralRules(localeTag(locale)).select(n) === "one" ? one : other, { n, ...vars });
  t.locale = locale;
  return t;
}

/** BCP 47 tag for Intl (numbers, dates, currencies). English keeps the US formats Page always used. */
export const localeTag = (locale: Locale) => (locale === "fr" ? "fr-FR" : "en-US");

/** "auto": the first supported language the browser asks for (Accept-Language), else English. */
export function pickLocale(setting: string | undefined, acceptLanguage?: string | null): Locale {
  if (setting === "en" || setting === "fr") return setting;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const lang = part.trim().slice(0, 2).toLowerCase();
    if ((LOCALES as readonly string[]).includes(lang)) return lang as Locale;
  }
  return "en";
}

/**
 * Marks English text that is translated later, where it's shown (tables outside components).
 * Returns it unchanged; the completeness test finds msg("…") like t("…").
 */
export const msg = <S extends string>(s: S) => s;

/** Every key that has a French translation (for the completeness test). */
export const frenchKeys = () => Object.keys(fr);
