"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Search } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { SymbolHit } from "@/lib/stocks/types";
import { useT } from "@/i18n/client";
import { inputClass } from "../edit/FieldInput";

/** Find a share, fund or index by name or symbol; `onPick` gets the one chosen. */
export function SymbolSearch({ onPick, placeholder, autoFocus }: { onPick: (hit: SymbolHit) => void; placeholder?: string; autoFocus?: boolean }) {
  const t = useT();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Ask once the typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const { data, error, isLoading } = useSWR<SymbolHit[]>(query.length >= 2 ? `/api/stocks/search?q=${encodeURIComponent(query)}` : null, fetcher, { keepPreviousData: true });

  const pick = (hit: SymbolHit) => {
    setText("");
    setOpen(false);
    onPick(hit);
  };

  return (
    <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        role="combobox"
        aria-expanded={open && query.length >= 2}
        aria-controls="symbol-hits"
        aria-label={placeholder ?? t("Search a share, fund or index")}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          // Enter takes the first match.
          if (e.key === "Enter" && open && data?.[0]) {
            e.preventDefault();
            pick(data[0]);
          }
        }}
        placeholder={placeholder ?? t("Search a share, fund or index")}
        className={`${inputClass} pl-9`}
      />
      {open && query.length >= 2 && (
        <ul id="symbol-hits" role="listbox" className="glass absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-2xl p-1.5" style={{ background: "var(--dialog)" }}>
          {error && <li className="px-2 py-1.5 text-sm text-[var(--err)]">{(error as Error).message}</li>}
          {!error && data?.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">{t("Nothing found.")}</li>}
          {!error && !data && isLoading && <li className="px-2 py-1.5 text-sm text-muted">{t("Searching…")}</li>}
          {data?.map((hit) => (
            <li key={hit.symbol} role="option" aria-selected={false}>
              <button type="button" onClick={() => pick(hit)} className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hover">
                <span className="w-20 shrink-0 font-semibold">{hit.symbol}</span>
                <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                <span className="shrink-0 text-xs text-muted">{hit.exchange}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
