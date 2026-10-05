import { slugify } from "./config/slug";

export interface Tab {
  name: string;
  slug: string;
}

/**
 * Tabs in display order: those listed in settings first, then any others in the order groups use them.
 * Groups without a tab belong to the first tab. No tabs anywhere means no tab bar.
 */
export function listTabs(order: string[] | undefined, groups: { tab?: string }[]): Tab[] {
  const names: string[] = [];
  for (const n of [...(order ?? []), ...groups.map((g) => g.tab)]) {
    if (n && !names.includes(n)) names.push(n);
  }
  if (names.length && groups.some((g) => !g.tab) && !order?.length) {
    const home = names.indexOf("Home");
    if (home !== -1) names.splice(home, 1);
    names.unshift("Home");
  }
  return names.map((name, i) => ({ name, slug: i === 0 ? "" : slugify(name) }));
}

export const tabOf = (tabs: Tab[], groupTab?: string) => groupTab ?? tabs[0]?.name;

/** The tab for a URL path ("/" is the first tab). Undefined when the slug doesn't exist. */
export function tabForPath(tabs: Tab[], path: string): Tab | undefined {
  const slug = path.replace(/^\/+|\/+$/g, "");
  if (!tabs.length) return slug ? undefined : { name: "", slug: "" };
  return tabs.find((t) => t.slug === slug);
}
