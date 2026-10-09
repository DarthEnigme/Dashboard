"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Star, X } from "lucide-react";
import { sendJson } from "@/lib/fetcher";
import type { Stop, Trip } from "@/lib/travel/store";
import { COUNTRIES, countryName, flag } from "@/lib/travel/geo";
import { Dialog } from "../edit/Dialog";
import { inputBase, inputClass } from "../edit/FieldInput";
import { CitySearch } from "./CitySearch";
import { useT } from "@/i18n/client";

const today = () => new Date().toISOString().slice(0, 10);

/** Add or edit a trip: name, dates, the stops in order (cities or whole countries), who came, a rating and notes. */
export function TripEditor({ trip, people, onClose, onSaved }: { trip?: Trip; people: { id: number; name: string }[]; onClose: () => void; onSaved: (trips: Trip[]) => void }) {
  const t = useT();
  const [title, setTitle] = useState(trip?.title ?? "");
  const [start, setStart] = useState(trip?.start_date ?? today());
  const [end, setEnd] = useState(trip?.end_date ?? today());
  const [stops, setStops] = useState<Stop[]>(trip?.stops ?? []);
  const [companions, setCompanions] = useState<Set<number>>(new Set(trip?.companions.map((c) => c.id) ?? []));
  const [rating, setRating] = useState<number | null>(trip?.rating ?? null);
  const [notes, setNotes] = useState(trip?.notes ?? "");
  const [country, setCountry] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const sorted = [...COUNTRIES].sort((a, b) => countryName(a.code, t.locale).localeCompare(countryName(b.code, t.locale), t.locale));

  const move = (i: number, d: number) =>
    setStops((s) => {
      const next = [...s];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const body = { id: trip?.id, title, start_date: start, end_date: end, stops, companions: [...companions], rating, notes };
      onSaved(await sendJson<Trip[]>("/api/travel/trips", trip ? "PATCH" : "POST", body));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={trip ? t("Edit {name}", { name: trip.title }) : t("New trip")} onClose={onClose} onSubmit={() => void submit()} error={error} busy={busy}>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
        {t("Name")}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("Summer in Portugal, Weekend in Rome…")} className={inputClass} autoFocus />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          {t("From")}
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
          {t("To")}
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted">{t("Stops")}</legend>
        {stops.length > 0 && (
          <ol className="flex flex-col gap-1" aria-label={t("Stops")}>
            {stops.map((s, i) => (
              <li key={`${s.country}-${s.city}-${i}`} className="flex items-center gap-2 rounded-lg bg-chip px-2 py-1 text-sm">
                <span className="w-5 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                <span aria-hidden>{flag(s.country)}</span>
                <span className="mr-auto truncate">{s.city ? `${s.city}, ${countryName(s.country, t.locale)}` : countryName(s.country, t.locale)}</span>
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Move up")} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label={t("Move down")} className="rounded p-1 text-muted hover:bg-hover disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setStops((st) => st.filter((_, j) => j !== i))} aria-label={t("Remove {name}", { name: s.city ?? countryName(s.country, t.locale) })} className="rounded p-1 text-muted hover:bg-hover hover:text-[var(--err)]">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>
        )}
        <CitySearch onPick={(p) => setStops((s) => [...s, { country: p.country, city: p.name, lat: p.lat, lon: p.lon, arrive: null, depart: null }])} placeholder={t("Add a city…")} />
        <div className="flex gap-2">
          <select aria-label={t("Or a whole country")} value={country} onChange={(e) => setCountry(e.target.value)} className={`${inputBase} min-w-0 flex-1`}>
            <option value="">{t("…or a whole country")}</option>
            {sorted.map((c) => (
              <option key={c.code} value={c.code}>
                {flag(c.code)} {countryName(c.code, t.locale)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!country}
            onClick={() => {
              setStops((s) => [...s, { country, city: null, lat: null, lon: null, arrive: null, depart: null }]);
              setCountry("");
            }}
            className="rounded-xl bg-track px-3 text-sm hover:bg-hover disabled:opacity-50"
          >
            {t("Add")}
          </button>
        </div>
      </fieldset>

      {people.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium text-muted">{t("Travelled with")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={companions.has(p.id)}
                  onChange={(e) =>
                    setCompanions((cur) => {
                      const next = new Set(cur);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    })
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
          <span className="text-xs text-muted">{t("They see this trip on their own map.")}</span>
        </fieldset>
      )}

      <div className="flex items-center gap-1" role="radiogroup" aria-label={t("Rating")}>
        <span className="mr-2 text-xs font-medium text-muted">{t("Rating")}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t("{n} of 5", { n })} onClick={() => setRating(rating === n ? null : n)} className="p-0.5">
            <Star className={`h-5 w-5 ${rating && n <= rating ? "fill-[var(--warn)] text-[var(--warn)]" : "text-muted"}`} />
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
        {t("Notes")}
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputClass} h-auto py-2`} />
      </label>
    </Dialog>
  );
}
