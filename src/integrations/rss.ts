import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import { http } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";

const schema = z.object({
  urls: z.array(z.string().url()).min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export interface FeedItem {
  title: string;
  link?: string;
  date?: Date;
  source?: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : v && typeof v === "object" && "#text" in v ? String((v as { "#text": unknown })["#text"]) : "";

/** RSS 2.0 and Atom feeds. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  if (doc.rss) {
    const ch = doc.rss.channel ?? {};
    return arr(ch.item).map((i: Record<string, unknown>) => ({
      title: text(i.title).trim() || "Untitled",
      link: text(i.link) || undefined,
      date: i.pubDate ? new Date(text(i.pubDate)) : undefined,
      source: text(ch.title) || undefined,
    }));
  }
  if (doc.feed) {
    return arr(doc.feed.entry).map((e: Record<string, unknown>) => {
      const links = arr(e.link as Record<string, string> | Record<string, string>[]);
      const link = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
      return {
        title: text(e.title).trim() || "Untitled",
        link: link?.["@_href"],
        date: e.updated || e.published ? new Date(text(e.published ?? e.updated)) : undefined,
        source: text(doc.feed.title) || undefined,
      };
    });
  }
  throw new Error("Not an RSS or Atom feed");
}

export function age(d: Date | undefined, now = Date.now()): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const m = Math.max(0, Math.round((now - d.getTime()) / 60_000));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

export function feedResult(items: FeedItem[], limit: number, now = Date.now()): WidgetResult {
  const sorted = [...items].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)).slice(0, limit);
  return {
    fields: [],
    list: sorted.map((i) => ({ label: i.title, value: age(i.date, now), href: i.link })),
    compactList: 3,
  };
}

export const rss: Integration<typeof schema> = {
  type: "rss",
  schema,
  async fetch(cfg) {
    const feeds = await Promise.all(
      cfg.urls.map(async (url) => {
        const res = await http(url, { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9" } });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
        return parseFeed(await res.text());
      }),
    );
    return feedResult(feeds.flat(), cfg.limit);
  },
};
