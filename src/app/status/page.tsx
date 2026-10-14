import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CheckCircle2, CircleDashed, Info, LayoutGrid, Megaphone, TriangleAlert, Wrench, XCircle } from "lucide-react";
import { loadConfig } from "@/lib/config/load";
import { statusPageData, type StatusDay, type StatusPosted, type StatusService } from "@/lib/statusPage";
import { msg } from "@/i18n";
import { duration } from "@/integrations/format";
import { personal } from "@/lib/userLook";
import { Background } from "@/components/Background";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Markdown } from "@/components/settings/Markdown";
import { getLocale } from "@/i18n/server";
import { localeTag, translator, type T } from "@/i18n";

export const dynamic = "force-dynamic";

const pageTitle = () => {
  const { settings } = loadConfig();
  return settings.statusPage.title?.trim() || `${settings.title} status`;
};

export function generateMetadata(): Metadata {
  return { title: pageTitle() };
}

const pct = (u: number | null) => (u === null ? "–" : `${(u * 100).toFixed(u === 1 ? 0 : 2)}%`);
const STATUS_LABELS = { investigating: msg("Investigating"), identified: msg("Identified"), monitoring: msg("Monitoring"), resolved: msg("Resolved") } as const;
const IMPACT_LABELS = { minor: msg("Minor"), major: msg("Major"), maintenance: msg("Maintenance") } as const;

const barColor = (u: number | null) => (u === null ? "bg-track" : u >= 0.999 ? "bg-[var(--ok)]" : u >= 0.95 ? "bg-[var(--warn)]" : "bg-[var(--err)]");

/**
 * Public status page: readable without signing in, even when the dashboard is private. Off unless
 * statusPage.enabled; shows names, state, uptime and outage times only (see lib/statusPage.ts),
 * plus the texts the admin wrote for it (intro, announcement, public maintenance notes, footer).
 */
export default async function StatusPage() {
  const all = loadConfig().settings;
  const cfg = all.statusPage;
  if (!cfg.enabled) notFound();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth, ...settings } = all;
  const locale = await getLocale();
  const t = translator(locale);
  const tag = localeTag(locale);
  const data = await statusPageData(cfg);
  const when = (ms: number) => new Date(ms).toLocaleString(tag, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const dayLabel = (d: StatusDay) => `${new Date(`${d.day}T12:00:00`).toLocaleDateString(tag, { month: "short", day: "numeric" })}: ${d.uptime === null ? t("no data") : pct(d.uptime)}`;
  // Without group headings, everything is one list.
  const groups = cfg.showGroups ? [...new Set(data.services.map((s) => s.group))] : [undefined];
  const unknown = data.services.length > 0 && data.services.every((s) => s.up === null);
  const warn = cfg.announcementLevel === "warn";
  // Incidents an admin posted and hasn't resolved: they shape the banner too.
  const open = data.posted.filter((p) => p.end === null);
  const past = data.posted.filter((p) => p.end !== null);
  const issue = open.find((p) => p.impact === "major") ?? open.find((p) => p.impact === "minor");
  const tone = data.down || issue?.impact === "major" ? "text-[var(--err)]" : issue ? "text-[var(--warn)]" : unknown || !data.services.length ? "text-muted" : "text-[var(--ok)]";

  return (
    <>
      <Background settings={await personal(settings)} />
      <AutoRefresh seconds={60} />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <header className="flex items-center gap-4">
          {cfg.logo && all.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={all.logo} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-contain" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{pageTitle()}</h1>
            {cfg.intro?.trim() && (
              <div className="mt-1 flex flex-col gap-1 text-sm text-muted">
                <Markdown text={cfg.intro} />
              </div>
            )}
          </div>
          {cfg.dashboardLink && (
            <Link href="/" className="glass glass-interactive flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium">
              <LayoutGrid className="h-4 w-4" aria-hidden /> {t("Dashboard")}
            </Link>
          )}
        </header>

        {cfg.announcement?.trim() && (
          <section className={`glass flex items-start gap-3 rounded-3xl p-5 text-sm ${warn ? "text-[var(--warn)]" : ""}`} aria-label={t("Announcement")}>
            {warn ? <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />}
            <div className="flex min-w-0 flex-col gap-1">
              <Markdown text={cfg.announcement} />
            </div>
          </section>
        )}

        <section role="status" className={`glass flex items-center gap-3 rounded-3xl p-5 text-lg font-semibold ${tone}`}>
          {data.down ? (
            <XCircle className="h-6 w-6 shrink-0" aria-hidden />
          ) : issue ? (
            <TriangleAlert className="h-6 w-6 shrink-0" aria-hidden />
          ) : unknown || !data.services.length ? (
            <CircleDashed className="h-6 w-6 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden />
          )}
          {!data.services.length
            ? t("No services are listed here yet.")
            : data.down
              ? t.plural(data.down, "{n} service is down", "{n} services are down")
              : issue
                ? issue.title
                : unknown
                  ? t("Waiting for the first checks")
                  : t("All services are up")}
        </section>

        {open.length > 0 && (
          <section className="glass flex flex-col gap-4 rounded-3xl p-5" aria-labelledby="current-incidents">
            <h2 id="current-incidents" className="flex items-center gap-2 text-sm font-semibold tracking-wider text-muted uppercase">
              <Megaphone className="h-4 w-4" aria-hidden /> {t("Current incidents")}
            </h2>
            {open.map((p) => (
              <Posted key={p.id} p={p} t={t} when={when} />
            ))}
          </section>
        )}

        {data.upcoming.length > 0 && (
          <section className="glass flex flex-col gap-3 rounded-3xl p-5" aria-labelledby="upcoming">
            <h2 id="upcoming" className="flex items-center gap-2 text-sm font-semibold tracking-wider text-muted uppercase">
              <CalendarClock className="h-4 w-4" aria-hidden /> {t("Upcoming maintenance")}
            </h2>
            <ol className="flex flex-col gap-1.5">
              {data.upcoming.map((u) => (
                <li key={`${u.start}-${u.services.join()}-${u.name ?? ""}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl bg-chip px-3 py-2 text-sm" data-upcoming>
                  <span className="font-medium">{u.services.length ? u.services.join(", ") : t("All services")}</span>
                  {u.name && <span className="rounded-full bg-track px-2 text-xs text-muted">{u.name}</span>}
                  <span className="ml-auto text-muted tabular-nums">
                    {when(u.start)}
                    {u.end !== null && ` → ${when(u.end)}`}
                  </span>
                  {u.note && <span className="w-full text-xs text-muted">{u.note}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {groups.map((group) => (
          <section key={group ?? "all"} className="glass flex flex-col gap-4 rounded-3xl p-5">
            {group !== undefined && <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{group}</h2>}
            <ul className="flex flex-col gap-4">
              {data.services
                .filter((s) => group === undefined || s.group === group)
                .map((s) => (
                  <li key={`${s.group}/${s.name}`} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <State s={s} t={t} />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      {s.maintenance && (
                        <span className="flex items-center gap-1 rounded-full bg-track px-2 py-0.5 text-xs text-muted">
                          <Wrench className="h-3 w-3" aria-hidden /> {t("Maintenance")}
                        </span>
                      )}
                      {cfg.showUptime && <span className="shrink-0 tabular-nums text-muted">{pct(s.uptime)}</span>}
                    </div>
                    {s.maintenance && s.note && <p className="text-xs text-muted">{s.note}</p>}
                    {cfg.showBars && (
                      // One bar per day, oldest first; the label says the same in text.
                      <div className="flex h-7 gap-px" role="img" aria-label={t("Uptime over the last {n} days: {uptime}", { n: s.days.length, uptime: pct(s.uptime) })}>
                        {s.days.map((d) => (
                          <span key={d.day} title={dayLabel(d)} className={`min-w-0 flex-1 rounded-[2px] ${barColor(d.uptime)}`} />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))}

        {past.length > 0 && (
          <section className="glass flex flex-col gap-4 rounded-3xl p-5" aria-labelledby="past-incidents">
            <h2 id="past-incidents" className="text-sm font-semibold tracking-wider text-muted uppercase">
              {t.plural(cfg.incidentDays, "Incidents in the last day", "Incidents in the last {n} days")}
            </h2>
            {past.map((p) => (
              <Posted key={p.id} p={p} t={t} when={when} />
            ))}
          </section>
        )}

        {cfg.showIncidents && (
          <section className="glass flex flex-col gap-3 rounded-3xl p-5">
            <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{t.plural(cfg.incidentDays, "Outages in the last day", "Outages in the last {n} days")}</h2>
            {data.incidents.length ? (
              <ol className="flex flex-col gap-1.5">
                {data.incidents.map((i) => (
                  <li key={`${i.service}-${i.start}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl bg-chip px-3 py-2 text-sm">
                    <span className="font-medium">{i.service}</span>
                    {i.planned && <span className="rounded-full bg-track px-2 text-xs text-muted">{t("planned")}</span>}
                    <span className="text-muted">{when(i.start)}</span>
                    <span className="ml-auto text-muted">
                      {i.end === null ? t("ongoing") : t("lasted {time}", { time: duration(Math.max(1, (i.end - i.start) / 1000)) })}
                    </span>
                    {i.note && <span className="w-full text-xs text-muted">{i.note}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">{t("No outages.")}</p>
            )}
          </section>
        )}

        <footer className="flex flex-col items-center gap-2 text-center text-xs text-muted">
          {cfg.footer?.trim() && (
            <div className="flex flex-col gap-1 text-sm">
              <Markdown text={cfg.footer} />
            </div>
          )}
          <p>{t("Updated {time}", { time: when(data.at) })}</p>
        </footer>
      </main>
    </>
  );
}

function State({ s, t }: { s: StatusService; t: T }) {
  if (s.up === null) return <CircleDashed className="h-4 w-4 shrink-0 text-muted" aria-label={t("Not checked yet")} />;
  return s.up ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ok)]" aria-label={t("Up")} /> : <XCircle className="h-4 w-4 shrink-0 text-[var(--err)]" aria-label={t("Down")} />;
}

/** One posted incident: title, impact, services, and its updates (newest first; older ones folded). */
function Posted({ p, t, when }: { p: StatusPosted; t: T; when: (ms: number) => string }) {
  const [latest, ...older] = p.updates;
  const tone = p.end !== null ? "text-[var(--ok)]" : p.impact === "major" ? "text-[var(--err)]" : p.impact === "maintenance" ? "text-accent" : "text-[var(--warn)]";
  const Update = ({ u }: { u: StatusPosted["updates"][number] }) => (
    <li className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">
        <strong className="font-semibold text-fg">{t(STATUS_LABELS[u.status])}</strong> · {when(u.at)}
      </span>
      {u.body && <Markdown text={u.body} />}
    </li>
  );
  return (
    <article className="flex flex-col gap-2 rounded-2xl bg-chip p-4" data-posted={p.title}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={`min-w-0 flex-1 font-semibold ${tone}`}>{p.title}</h3>
        <span className="rounded-full bg-track px-2 py-0.5 text-xs text-muted">{t(IMPACT_LABELS[p.impact])}</span>
      </div>
      {p.services.length > 0 && <p className="text-xs text-muted">{p.services.join(", ")}</p>}
      <ol className="flex flex-col gap-2">{latest && <Update u={latest} />}</ol>
      {older.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted">{t.plural(older.length, "{n} earlier update", "{n} earlier updates")}</summary>
          <ol className="mt-2 flex flex-col gap-2 border-l border-line pl-3">
            {older.map((u, i) => (
              <Update key={i} u={u} />
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}
