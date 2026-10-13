import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleDashed, Wrench, XCircle } from "lucide-react";
import { loadConfig } from "@/lib/config/load";
import { statusPageData, type StatusDay, type StatusService } from "@/lib/statusPage";
import { duration } from "@/integrations/format";
import { Background } from "@/components/Background";
import { AutoRefresh } from "@/components/AutoRefresh";
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
const barColor = (u: number | null) => (u === null ? "bg-track" : u >= 0.999 ? "bg-[var(--ok)]" : u >= 0.95 ? "bg-[var(--warn)]" : "bg-[var(--err)]");

/**
 * Public status page: readable without signing in, even when the dashboard is private. Off unless
 * statusPage.enabled; shows names, state, uptime and outage times only (see lib/statusPage.ts).
 */
export default async function StatusPage() {
  const all = loadConfig().settings;
  if (!all.statusPage.enabled) notFound();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { alerts, docker, auth, ...settings } = all;
  const locale = await getLocale();
  const t = translator(locale);
  const tag = localeTag(locale);
  const data = await statusPageData(all.statusPage);
  const when = (ms: number) => new Date(ms).toLocaleString(tag, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const dayLabel = (d: StatusDay) => `${new Date(`${d.day}T12:00:00`).toLocaleDateString(tag, { month: "short", day: "numeric" })}: ${d.uptime === null ? t("no data") : pct(d.uptime)}`;
  const groups = [...new Set(data.services.map((s) => s.group))];
  const unknown = data.services.length > 0 && data.services.every((s) => s.up === null);

  return (
    <>
      <Background settings={settings} />
      <AutoRefresh seconds={60} />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{pageTitle()}</h1>

        <section
          role="status"
          className={`glass flex items-center gap-3 rounded-3xl p-5 text-lg font-semibold ${data.down ? "text-[var(--err)]" : unknown || !data.services.length ? "text-muted" : "text-[var(--ok)]"}`}
        >
          {data.down ? <XCircle className="h-6 w-6 shrink-0" aria-hidden /> : unknown || !data.services.length ? <CircleDashed className="h-6 w-6 shrink-0" aria-hidden /> : <CheckCircle2 className="h-6 w-6 shrink-0" aria-hidden />}
          {!data.services.length
            ? t("No services are listed here yet.")
            : data.down
              ? t.plural(data.down, "{n} service is down", "{n} services are down")
              : unknown
                ? t("Waiting for the first checks")
                : t("All services are up")}
        </section>

        {groups.map((group) => (
          <section key={group} className="glass flex flex-col gap-4 rounded-3xl p-5">
            <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{group}</h2>
            <ul className="flex flex-col gap-4">
              {data.services
                .filter((s) => s.group === group)
                .map((s) => (
                  <li key={s.name} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <State s={s} t={t} />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                      {s.maintenance && (
                        <span className="flex items-center gap-1 rounded-full bg-track px-2 py-0.5 text-xs text-muted">
                          <Wrench className="h-3 w-3" aria-hidden /> {t("Maintenance")}
                        </span>
                      )}
                      <span className="shrink-0 tabular-nums text-muted">{pct(s.uptime)}</span>
                    </div>
                    {/* One bar per day, oldest first; the percentage beside the name says the same in text. */}
                    <div className="flex h-7 gap-px" role="img" aria-label={t("Uptime over the last {n} days: {uptime}", { n: s.days.length, uptime: pct(s.uptime) })}>
                      {s.days.map((d) => (
                        <span key={d.day} title={dayLabel(d)} className={`min-w-0 flex-1 rounded-[2px] ${barColor(d.uptime)}`} />
                      ))}
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))}

        <section className="glass flex flex-col gap-3 rounded-3xl p-5">
          <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">{t("Outages in the last 14 days")}</h2>
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
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">{t("No outages.")}</p>
          )}
        </section>

        <p className="text-center text-xs text-muted">
          {t("Updated {time}", { time: when(data.at) })}
        </p>
      </main>
    </>
  );
}

function State({ s, t }: { s: StatusService; t: T }) {
  if (s.up === null) return <CircleDashed className="h-4 w-4 shrink-0 text-muted" aria-label={t("Not checked yet")} />;
  return s.up ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ok)]" aria-label={t("Up")} /> : <XCircle className="h-4 w-4 shrink-0 text-[var(--err)]" aria-label={t("Down")} />;
}
