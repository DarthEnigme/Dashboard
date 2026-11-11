"use client";

import { ChevronDown, X } from "lucide-react";
import { MEASURES, groupOf, type MeasureGroup, type Period } from "@/lib/stocks/metrics";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { Menu } from "../../edit/Menu";
import { Choice } from "../parts";
import { SymbolIcon } from "../SymbolIcon";
import { SymbolSearch } from "../SymbolSearch";

const GROUPS: { id: MeasureGroup; label: string }[] = [
  { id: "reported", label: msg("Reported figures") },
  { id: "ratios", label: msg("Ratios and growth") },
  { id: "market", label: msg("Market, today") },
];

interface Props {
  symbols: string[];
  onSymbols: (s: string[]) => void;
  measures: string[];
  onMeasures: (m: string[]) => void;
  period: Period;
  onPeriod: (p: Period) => void;
  /** Symbols held, offered in one click. */
  holdings?: string[];
}

/** Which symbols, which figures and which periods: shared by the comparison and the figures export. */
export function FigurePicker({ symbols, onSymbols, measures, onMeasures, period, onPeriod, holdings = [] }: Props) {
  const t = useT();
  const toggle = (id: string) => onMeasures(measures.includes(id) ? measures.filter((m) => m !== id) : [...measures, id]);
  const missing = holdings.filter((h) => !symbols.includes(h));

  return (
    <div className="glass flex flex-col gap-3 rounded-3xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        {symbols.map((s) => (
          <span key={s} className="flex items-center gap-1.5 rounded-full bg-chip py-1 pr-1 pl-1.5 text-sm font-medium">
            <SymbolIcon symbol={s} size={20} />
            {s}
            <button type="button" onClick={() => onSymbols(symbols.filter((x) => x !== s))} aria-label={t("Remove {symbol}", { symbol: s })} className="rounded-full p-0.5 text-muted hover:bg-hover hover:text-fg">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <div className="w-64">
          <SymbolSearch placeholder={t("Add a symbol to compare")} onPick={(hit) => !symbols.includes(hit.symbol) && onSymbols([...symbols, hit.symbol].slice(0, 12))} />
        </div>
        {missing.length > 0 && (
          <button type="button" onClick={() => onSymbols([...symbols, ...missing].slice(0, 12))} className="rounded-full px-3 py-1.5 text-sm text-accent hover:bg-hover">
            {t("Add my holdings")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Menu
          label={t("Figures")}
          width="w-80"
          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm hover:bg-hover"
          button={
            <>
              {t.plural(measures.length, "{n} figure", "{n} figures")} <ChevronDown className="h-4 w-4 text-muted" />
            </>
          }
        >
          {() => (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto p-1">
              {GROUPS.map((g) => (
                <fieldset key={g.id}>
                  <legend className="px-1 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{t(g.label)}</legend>
                  {MEASURES.filter((m) => groupOf(m) === g.id).map((m) => (
                    <label key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-hover">
                      <input type="checkbox" checked={measures.includes(m.id)} onChange={() => toggle(m.id)} />
                      {t(m.label)}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )}
        </Menu>
        <Choice
          label={t("Period")}
          value={period}
          onChange={onPeriod}
          options={[
            { id: "annual", label: t("Yearly") },
            { id: "quarterly", label: t("Quarterly") },
          ]}
        />
      </div>
    </div>
  );
}
