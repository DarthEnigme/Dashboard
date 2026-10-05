import { z } from "zod";
import ical from "node-ical";
import { http, httpJson, trimSlash } from "@/lib/http";
import type { Integration, WidgetResult } from "./types";

const source = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ical"), url: z.string().url(), name: z.string().optional(), insecure: z.boolean().optional() }),
  z.object({ type: z.literal("sonarr"), url: z.string().url(), key: z.string().min(1), insecure: z.boolean().optional() }),
  z.object({ type: z.literal("radarr"), url: z.string().url(), key: z.string().min(1), insecure: z.boolean().optional() }),
]);

const schema = z.object({
  sources: z.array(source).min(1),
  days: z.coerce.number().int().min(1).max(90).default(14),
  timezone: z.string().optional(),
});

export interface CalendarItem {
  start: Date;
  title: string;
  allDay: boolean;
}

const DAY = 86_400_000;

/** Events from ICS text between from and to, with recurring events expanded. */
export function icsItems(text: string, from: Date, to: Date): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const ev of Object.values(ical.sync.parseICS(text))) {
    if (!ev || ev.type !== "VEVENT" || !ev.start) continue;
    const title = typeof ev.summary === "string" ? ev.summary : ((ev.summary as { val?: string })?.val ?? "Untitled");
    const allDay = (ev as { datetype?: string }).datetype === "date";
    if (ev.rrule) {
      const exdates = new Set(Object.values(ev.exdate ?? {}).map((d) => new Date(d as Date).toISOString().slice(0, 10)));
      for (const raw of ev.rrule.between(from, to, true)) {
        // rrule hands back "floating" dates: the real instant shifted by the server's UTC offset on
        // that day. Undo the shift (a no-op on UTC servers, e.g. in Docker).
        const d = allDay ? raw : new Date(raw.getTime() + raw.getTimezoneOffset() * 60_000);
        if (!exdates.has(d.toISOString().slice(0, 10))) out.push({ start: d, title, allDay });
      }
    } else if (ev.start >= from && ev.start < to) {
      out.push({ start: new Date(ev.start), title, allDay });
    }
  }
  return out;
}

export function sonarrItems(eps: { airDateUtc?: string; title?: string; seasonNumber: number; episodeNumber: number; series?: { title: string } }[]): CalendarItem[] {
  return eps
    .filter((e) => e.airDateUtc)
    .map((e) => ({
      start: new Date(e.airDateUtc!),
      title: `${e.series?.title ?? "Episode"} S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`,
      allDay: false,
    }));
}

export function radarrItems(movies: { title: string; digitalRelease?: string; physicalRelease?: string; inCinemas?: string }[], from: Date, to: Date): CalendarItem[] {
  return movies.flatMap((m) => {
    const dates = [
      [m.inCinemas, "in cinemas"],
      [m.digitalRelease, "digital"],
      [m.physicalRelease, "physical"],
    ]
      .filter(([d]) => d)
      .map(([d, kind]) => ({ d: new Date(d!), kind }))
      .filter(({ d }) => d >= from && d < to);
    return dates.map(({ d, kind }) => ({ start: d, title: `${m.title} (${kind})`, allDay: true }));
  });
}

/** Upcoming items as list rows: "Today 20:00", "Tomorrow", "Tue 14 Oct"… */
export function calendarResult(items: CalendarItem[], now: Date, timeZone?: string): WidgetResult {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + DAY));
  const weekEnd = now.getTime() + 7 * DAY;
  const sorted = items.filter((i) => i.start.getTime() >= now.getTime() - (i.allDay ? DAY : 0)).sort((a, b) => a.start.getTime() - b.start.getTime());
  const when = (i: CalendarItem) => {
    const d = day(i.start);
    const time = i.allDay ? "" : ` ${new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(i.start)}`;
    if (d === today) return `Today${time}`;
    if (d === tomorrow) return `Tomorrow${time}`;
    return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(i.start) + time;
  };
  return {
    fields: [
      { label: "Today", value: sorted.filter((i) => day(i.start) === today).length },
      { label: "Next 7 days", value: sorted.filter((i) => i.start.getTime() < weekEnd).length },
    ],
    list: sorted.slice(0, 50).map((i) => ({ label: i.title, value: when(i) })),
    compactList: 3,
  };
}

export const calendar: Integration<typeof schema> = {
  type: "calendar",
  schema,
  async fetch(cfg) {
    const now = new Date();
    const from = new Date(now.getTime() - DAY);
    const to = new Date(now.getTime() + cfg.days * DAY);
    const range = new URLSearchParams({ start: from.toISOString(), end: to.toISOString() });
    const lists = await Promise.all(
      cfg.sources.map(async (s): Promise<CalendarItem[]> => {
        if (s.type === "ical") {
          const res = await http(s.url.replace(/^webcal:/, "https:"), { insecure: s.insecure });
          if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(s.url).host}`);
          return icsItems(await res.text(), from, to);
        }
        const opts = { insecure: s.insecure, headers: { "X-Api-Key": s.key } };
        if (s.type === "sonarr") return sonarrItems(await httpJson(`${trimSlash(s.url)}/api/v3/calendar?${range}&includeSeries=true`, opts));
        return radarrItems(await httpJson(`${trimSlash(s.url)}/api/v3/calendar?${range}`, opts), from, to);
      }),
    );
    return calendarResult(lists.flat(), now, cfg.timezone);
  },
};
