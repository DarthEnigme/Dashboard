"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { countryName, flag } from "@/lib/travel/geo";
import { inputClass } from "../edit/FieldInput";
import { useT } from "@/i18n/client";

export interface PlaceHit {
  name: string;
  country: string;
  region: string | null;
  lat: number;
  lon: number;
}

/** Type a city, pick it from the results (Open-Meteo's place search, through Page). */
export function CitySearch({ onPick, placeholder }: { onPick: (p: PlaceHit) => void; placeholder?: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setHits([]);
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        setHits(await fetcher<PlaceHit[]>(`/api/travel/geocode?q=${encodeURIComponent(term)}`));
        setError(undefined);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="relative">
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? t("Search a city…")}
          aria-label={t("Search a city")}
          className={`${inputClass} pl-9`}
        />
      </label>
      {(hits.length > 0 || error || (busy && q.trim().length >= 2)) && (
        <ul role="listbox" aria-label={t("Places found")} className="glass absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-xl p-1" style={{ background: "var(--dialog)" }}>
          {error && <li className="px-3 py-2 text-sm text-[var(--err)]">{error}</li>}
          {!error && busy && !hits.length && <li className="px-3 py-2 text-sm text-muted">{t("Searching…")}</li>}
          {hits.map((h) => (
            <li key={`${h.name}-${h.lat}-${h.lon}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(h);
                  setQ("");
                  setHits([]);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-hover"
              >
                <span aria-hidden>{flag(h.country)}</span>
                <span className="font-medium">{h.name}</span>
                <span className="truncate text-xs text-muted">{[h.region, countryName(h.country, t.locale)].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
