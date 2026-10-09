"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { localeTag, translator, type Locale, type T } from "./index";
import { setFormatLocale } from "./format";

const I18n = createContext<Locale>("en");

/** Set once in the root layout from the language setting (and the browser's, for "auto"). */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  // Formatting helpers outside React (money(), monthLabel()) follow the page's language.
  setFormatLocale(localeTag(locale));
  return <I18n.Provider value={locale}>{children}</I18n.Provider>;
}

export const useLocale = () => useContext(I18n);

export function useT(): T {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
