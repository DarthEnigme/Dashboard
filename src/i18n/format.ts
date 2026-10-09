/**
 * The locale that number and date helpers outside React use (money(), monthLabel()…). The page
 * has one language, set by I18nProvider before anything renders.
 */
let tag = "en-US";

export const setFormatLocale = (t: string) => {
  tag = t;
};
export const formatLocale = () => tag;

/** A date and time in the page's language, e.g. "Oct 9, 2026, 8:32 PM" / "9 oct. 2026, 20:32". */
export const dateTime = (d: Date | number | string) => new Date(d).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" });
export const dateOnly = (d: Date | number | string) => new Date(d).toLocaleDateString(tag, { dateStyle: "medium" });
export const number = (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(tag, opts).format(n);
