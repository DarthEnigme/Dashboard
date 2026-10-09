"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { motion } from "framer-motion";
import { ArrowLeft, Globe2, LogOut, Map as MapIcon, Pencil, Plus, Star, Trash2, Users } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Place, PlaceStatus, Trip, TravelStats } from "@/lib/travel/store";
import { COUNTRIES, countryIndex, countryName, flag } from "@/lib/travel/geo";
import { msg } from "@/i18n";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Globe, type GlobeCity } from "./Globe";
import { TripEditor } from "./TripEditor";
import { CitySearch } from "./CitySearch";
import { DeleteButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";

interface Data {
  places: Place[];
  trips: Trip[];
  stats: TravelStats;
  people: { id: number; name: string }[];
}

const KEY = "/api/travel";
const VIEWS = ["map", "trips", "places"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = { map: msg("Map"), trips: msg("Trips"), places: msg("Places") };
const STATUS_LABELS: Record<PlaceStatus, string> = { visited: msg("Visited"), lived: msg("Lived there"), want: msg("Want to go") };
const CONTINENTS: Record<string, string> = {
  AF: msg("Africa"),
  AN: msg("Antarctica"),
  AS: msg("Asia"),
  EU: msg("Europe"),
  NA: msg("North America"),
  OC: msg("Oceania"),
  SA: msg("South America"),
};
const today = () => new Date().toISOString().slice(0, 10);
const nights = (t: Trip) => Math.round((Date.parse(t.end_date) - Date.parse(t.start_date)) / 86_400_000);

/** The travel log: a globe of where you've been, your trips, and every country and city you've marked. */
export function TravelPage() {
  const t = useT();
  const { data, mutate, error } = useSWR<Data>(KEY, fetcher);
  const [view, setView] = useState<View>("map");
  const [selected, setSelected] = useState<string>();
  const [flat, setFlat] = useState(false);
  const [editing, setEditing] = useState<Trip | "new">();

  const places = data?.places ?? [];
  const trips = data?.trips ?? [];
  const started = trips.filter((tr) => tr.start_date <= today());
  const visited = useMemo(() => new Set([...places.filter((p) => p.status !== "want").map((p) => p.country), ...started.flatMap((tr) => tr.stops.map((s) => s.country))]), [places, started]);
  const wanted = useMemo(() => new Set(places.filter((p) => p.status === "want" && !visited.has(p.country)).map((p) => p.country)), [places, visited]);
  const cities = useMemo<GlobeCity[]>(
    () => [
      ...places.filter((p) => p.status !== "want" && p.lat !== null && p.lon !== null).map((p) => ({ lat: p.lat!, lon: p.lon!, label: p.city ?? p.country })),
      ...started.flatMap((tr) => tr.stops.filter((s) => s.lat !== null && s.lon !== null).map((s) => ({ lat: s.lat!, lon: s.lon!, label: s.city ?? s.country }))),
    ],
    [places, started],
  );

  const refresh = (patch?: Partial<Data>) => mutate(patch && data ? { ...data, ...patch } : undefined, { revalidate: true });
  const setStatus = async (country: string, status: PlaceStatus | null) => {
    const existing = places.find((p) => p.country === country && !p.city);
    if (status === null && existing) await refresh({ places: await sendJson<Place[]>(`/api/travel/places?id=${existing.id}`, "DELETE") });
    else if (status) await refresh({ places: await sendJson<Place[]>("/api/travel/places", "POST", { country, status }) });
  };

  const s = data?.stats;
  const thisYear = s?.daysByYear.find((d) => d.year === today().slice(0, 4))?.days ?? 0;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {t("Dashboard")}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("Travel")}</h1>
          <p className="text-muted">{t("Where you've been, where you want to go, and every trip in between.")}</p>
        </div>
        <button type="button" onClick={() => setEditing("new")} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("New trip")}
        </button>
      </header>
      {error && <p className="text-[var(--err)]">{(error as Error).message}</p>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label={t("Travel stats")}>
        <Stat label={t("Countries")} value={s ? `${s.countries} / ${s.of}` : "–"} note={s ? t("{pct}% of the world", { pct: Math.round((s.countries / s.of) * 100) }) : undefined} />
        <Stat label={t("Continents")} value={s ? `${s.continents} / 6` : "–"} />
        <Stat label={t("Cities")} value={s ? String(s.cities) : "–"} />
        <Stat label={t("Trips")} value={s ? String(s.trips) : "–"} />
        <Stat label={t("Days away this year")} value={s ? String(thisYear) : "–"} />
        <Stat label={t("Longest trip")} value={s?.longest ? t.plural(s.longest.days, "{n} day", "{n} days") : "–"} note={s?.longest?.title} />
      </section>

      <nav className="glass flex w-fit flex-wrap gap-1 rounded-full p-1 text-sm" role="tablist" aria-label={t("Travel sections")}>
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`relative rounded-full px-4 py-1.5 ${view === v ? "text-white" : "text-muted hover:text-fg"}`}>
            {view === v && <motion.span layoutId="travel-tab" className="tab-pill absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
            <span className="relative">{t(VIEW_LABELS[v])}</span>
          </button>
        ))}
      </nav>

      {view === "map" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <section className="glass relative rounded-3xl p-4" aria-label={t("Map")}>
            <div className="absolute top-3 right-3 z-10 flex rounded-full bg-chip p-0.5 text-xs">
              {[false, true].map((f) => (
                <button key={String(f)} type="button" aria-pressed={flat === f} onClick={() => setFlat(f)} className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${flat === f ? "bg-accent text-white" : "text-muted hover:text-fg"}`}>
                  {f ? <MapIcon className="h-3.5 w-3.5" /> : <Globe2 className="h-3.5 w-3.5" />} {f ? t("Flat map") : t("Globe")}
                </button>
              ))}
            </div>
            <Globe visited={visited} wanted={wanted} cities={cities} selected={selected} onSelect={setSelected} flat={flat} />
            <ul className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted" aria-label={t("Legend")}>
              <li className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-accent" /> {t("Visited")}
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full ring-1 ring-accent" /> {t("Want to go")}
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-fg/30" /> {t("Not yet")}
              </li>
            </ul>
          </section>
          <aside className="glass flex flex-col gap-3 rounded-3xl p-4" aria-label={t("Country")}>
            {selected ? (
              <CountryPanel code={selected} places={places} trips={trips} visited={visited.has(selected)} onStatus={(st) => void setStatus(selected, st)} />
            ) : (
              <p className="text-sm text-muted">{t("Pick a country on the map to mark it or see your trips there.")}</p>
            )}
            <select aria-label={t("Pick a country")} value={selected ?? ""} onChange={(e) => setSelected(e.target.value || undefined)} className={`${inputBase} mt-auto w-full`}>
              <option value="">{t("Pick a country")}</option>
              {[...COUNTRIES]
                .sort((a, b) => countryName(a.code, t.locale).localeCompare(countryName(b.code, t.locale), t.locale))
                .map((c) => (
                  <option key={c.code} value={c.code}>
                    {flag(c.code)} {countryName(c.code, t.locale)}
                  </option>
                ))}
            </select>
          </aside>
        </div>
      )}

      {view === "trips" && <TripList trips={trips} onEdit={setEditing} onChanged={(list) => refresh({ trips: list })} />}
      {view === "places" && <PlaceList places={places} onChanged={(list) => refresh({ places: list })} />}

      {editing && data && (
        <TripEditor trip={editing === "new" ? undefined : editing} people={data.people} onClose={() => setEditing(undefined)} onSaved={(list) => refresh({ trips: list })} />
      )}
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="truncate text-xs text-muted">{note}</div>}
    </div>
  );
}

function CountryPanel({ code, places, trips, visited, onStatus }: { code: string; places: Place[]; trips: Trip[]; visited: boolean; onStatus: (s: PlaceStatus | null) => void }) {
  const t = useT();
  const c = COUNTRIES[countryIndex(code)];
  const mark = places.find((p) => p.country === code && !p.city);
  const here = trips.filter((tr) => tr.stops.some((s) => s.country === code));
  const cities = [...new Set([...places.filter((p) => p.country === code && p.city).map((p) => p.city!), ...here.flatMap((tr) => tr.stops.filter((s) => s.country === code && s.city).map((s) => s.city!))])];
  return (
    <div className="flex flex-col gap-3" data-country={code}>
      <div>
        <div className="text-3xl" aria-hidden>
          {flag(code)}
        </div>
        <h2 className="text-lg font-semibold">{countryName(code, t.locale)}</h2>
        <p className="text-xs text-muted">{t(CONTINENTS[c?.continent ?? "AN"])}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Mark as")}>
        {(Object.keys(STATUS_LABELS) as PlaceStatus[]).map((st) => (
          <button
            key={st}
            type="button"
            aria-pressed={mark?.status === st}
            onClick={() => onStatus(mark?.status === st ? null : st)}
            className="rounded-full bg-chip px-3 py-1 text-xs transition hover:bg-hover aria-pressed:bg-accent aria-pressed:text-white"
          >
            {t(STATUS_LABELS[st])}
          </button>
        ))}
      </div>
      {visited && !mark && here.length > 0 && <p className="text-xs text-muted">{t("Visited on a trip.")}</p>}
      {cities.length > 0 && (
        <p className="text-sm">
          <span className="text-xs text-muted">{t("Cities")}: </span>
          {cities.join(", ")}
        </p>
      )}
      {here.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {here.map((tr) => (
            <li key={tr.id} className="truncate">
              {tr.title} <span className="text-xs text-muted">· {dateOnly(tr.start_date)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TripList({ trips, onEdit, onChanged }: { trips: Trip[]; onEdit: (t: Trip) => void; onChanged: (list: Trip[]) => void }) {
  const t = useT();
  if (!trips.length) return <p className="glass rounded-3xl p-8 text-center text-sm text-muted">{t("No trips yet. Add one with New trip: its stops colour in the map.")}</p>;
  const years = [...new Set(trips.map((tr) => tr.start_date.slice(0, 4)))];
  return (
    <div className="flex flex-col gap-6">
      {years.map((y) => (
        <section key={y} aria-label={y} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wider text-muted">{y}</h2>
          <ol className="grid gap-3 md:grid-cols-2">
            {trips
              .filter((tr) => tr.start_date.startsWith(y))
              .map((tr) => (
                <li key={tr.id} className="glass flex flex-col gap-2 rounded-3xl p-4" data-trip={tr.title}>
                  <div className="flex items-start gap-2">
                    <div className="mr-auto min-w-0">
                      <h3 className="truncate font-semibold">{tr.title}</h3>
                      <p className="text-xs text-muted">
                        {dateOnly(tr.start_date)} → {dateOnly(tr.end_date)} · {t.plural(nights(tr), "{n} night", "{n} nights")}
                        {tr.start_date > today() && ` · ${t("upcoming")}`}
                      </p>
                    </div>
                    {tr.mine ? (
                      <>
                        <button type="button" onClick={() => onEdit(tr)} aria-label={t("Edit {name}", { name: tr.title })} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <DeleteButton label={t("Delete {name}", { name: tr.title })} onConfirm={async () => onChanged(await sendJson<Trip[]>(`/api/travel/trips?id=${tr.id}`, "DELETE"))} />
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => onChanged(await sendJson<Trip[]>(`/api/travel/trips?id=${tr.id}`, "DELETE"))}
                        title={t("Remove from my trips")}
                        aria-label={t("Leave {name}", { name: tr.title })}
                        className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {tr.stops.length > 0 && (
                    <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
                      {tr.stops.map((s, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted">→</span>}
                          <span aria-hidden>{flag(s.country)}</span>
                          {s.city ?? countryName(s.country, t.locale)}
                        </span>
                      ))}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                    {tr.rating && (
                      <span className="flex" aria-label={t("{n} of 5", { n: tr.rating })}>
                        {Array.from({ length: tr.rating }, (_, i) => (
                          <Star key={i} className="h-3.5 w-3.5 fill-[var(--warn)] text-[var(--warn)]" />
                        ))}
                      </span>
                    )}
                    {(tr.companions.length > 0 || !tr.mine) && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        {[...(tr.mine ? [] : [tr.owner]), ...tr.companions.map((c) => c.name)].join(", ")}
                      </span>
                    )}
                  </div>
                  {tr.notes && <p className="text-sm whitespace-pre-line text-fg/90">{tr.notes}</p>}
                </li>
              ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function PlaceList({ places, onChanged }: { places: Place[]; onChanged: (list: Place[]) => void }) {
  const t = useT();
  const [status, setStatus] = useState<PlaceStatus>("visited");
  const add = async (p: { country: string; city?: string; lat?: number; lon?: number }) => onChanged(await sendJson<Place[]>("/api/travel/places", "POST", { ...p, status }));
  const byCountry = [...new Set(places.map((p) => p.country))].sort((a, b) => countryName(a, t.locale).localeCompare(countryName(b, t.locale), t.locale));
  return (
    <section className="flex flex-col gap-3" aria-label={t("Places")}>
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <div className="min-w-56 flex-1">
          <CitySearch onPick={(h) => void add({ country: h.country, city: h.name, lat: h.lat, lon: h.lon })} placeholder={t("Add a city you've been to…")} />
        </div>
        <select aria-label={t("Mark as")} value={status} onChange={(e) => setStatus(e.target.value as PlaceStatus)} className={`${inputBase} w-40`}>
          {(Object.keys(STATUS_LABELS) as PlaceStatus[]).map((st) => (
            <option key={st} value={st}>
              {t(STATUS_LABELS[st])}
            </option>
          ))}
        </select>
      </div>
      {!places.length && <p className="glass rounded-3xl p-8 text-center text-sm text-muted">{t("No places yet. Search a city above, or pick a country on the map.")}</p>}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {byCountry.map((code) => (
          <li key={code} className="glass flex flex-col gap-1.5 rounded-2xl p-3" data-place={code}>
            <div className="flex items-center gap-2">
              <span className="text-xl" aria-hidden>
                {flag(code)}
              </span>
              <span className="mr-auto font-medium">{countryName(code, t.locale)}</span>
            </div>
            <ul className="flex flex-col gap-0.5 text-sm">
              {places
                .filter((p) => p.country === code)
                .map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span className="mr-auto truncate">{p.city ?? t("Whole country")}</span>
                    <span className="rounded-full bg-chip px-2 py-0.5 text-[11px] text-muted">{t(STATUS_LABELS[p.status])}</span>
                    <button type="button" onClick={async () => onChanged(await sendJson<Place[]>(`/api/travel/places?id=${p.id}`, "DELETE"))} aria-label={t("Remove {name}", { name: p.city ?? countryName(code, t.locale) })} className="rounded p-1 text-muted hover:bg-hover hover:text-[var(--err)]">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
