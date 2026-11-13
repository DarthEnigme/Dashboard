"use client";

import { REPEAT_UNITS, type Repeat, type RepeatUnit } from "@/lib/tasks/repeat";
import type { ServiceRef } from "@/lib/tasks/types";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { inputClass, labelClass } from "../edit/FieldInput";

const UNIT_LABELS: Record<RepeatUnit, [one: string, many: string]> = {
  day: [msg("day"), msg("days")],
  week: [msg("week"), msg("weeks")],
  month: [msg("month"), msg("months")],
};

/** Never, or every N days, weeks or months. */
export function RepeatField({ value, onChange }: { value: Repeat | null; onChange: (v: Repeat | null) => void }) {
  const t = useT();
  return (
    <div className={labelClass}>
      <label htmlFor="task-repeat">{t("Repeat")}</label>
      <div className="flex gap-2">
        <select id="task-repeat" value={value ? "on" : ""} onChange={(e) => onChange(e.target.value ? { every: 1, unit: "week" } : null)} className={inputClass}>
          <option value="">{t("Never")}</option>
          <option value="on">{t("Every…")}</option>
        </select>
        {value && (
          <>
            <input
              type="number"
              min={1}
              max={365}
              value={value.every}
              onChange={(e) => onChange({ ...value, every: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
              aria-label={t("Repeat every")}
              className={`${inputClass} w-20`}
            />
            <select value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as RepeatUnit })} aria-label={t("Repeat unit")} className={inputClass}>
              {REPEAT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(UNIT_LABELS[u][value.every === 1 ? 0 : 1])}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}

/** The service a task is about, by group; one no longer in the config stays selectable by its id. */
export function ServiceField({ services, value, onChange }: { services: ServiceRef[]; value: string | null; onChange: (v: string | null) => void }) {
  const t = useT();
  return (
    <label className={labelClass}>
      {t("About service")}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={inputClass}>
        <option value="">{t("None")}</option>
        {value && !services.some((s) => s.id === value) && <option value={value}>{value}</option>}
        {[...new Set(services.map((s) => s.group))].map((group) => (
          <optgroup key={group} label={group}>
            {services
              .filter((s) => s.group === group)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
