"use client";

import useSWR from "swr";
import { AlertTriangle, Download } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { APPS } from "@/lib/config/schema";
import type { ModuleStatus } from "@/lib/module-retention";
import { APP_SECTIONS } from "@/lib/sections";
import { dateOnly } from "@/i18n/format";
import { useT } from "@/i18n/client";

export const MODULES_URL = "/api/modules";

/**
 * Settings → General → Apps: a checkbox per app. One turned off keeps its data for a while
 * (with a copy in the backup folder), then it is deleted.
 */
export function ModulePicker({ value, saved, onChange }: { value: unknown; saved: unknown; onChange: (v: string[]) => void }) {
  const t = useT();
  const { data } = useSWR<{ off: ModuleStatus[]; retentionDays: number }>(MODULES_URL, fetcher);
  // A missing key means every app (as before 0.6).
  const on = Array.isArray(value) ? (value as string[]) : [...APPS];
  const wasOn = Array.isArray(saved) ? (saved as string[]) : [...APPS];
  const days = data?.retentionDays ?? 30;

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{t("Apps")}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {APP_SECTIONS.map((s) => {
          const checked = on.includes(s.permission);
          const pending = data?.off.find((o) => o.app === s.permission);
          return (
            <div key={s.id} className="flex flex-col gap-1 rounded-xl border border-line bg-chip px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  // Kept in APPS order so the YAML doesn't change when nothing did.
                  onChange={(e) => onChange(APPS.filter((a) => (a === s.permission ? e.target.checked : on.includes(a))))}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <s.icon className="h-4 w-4 shrink-0 text-muted" />
                {t(s.label)}
              </label>
              {!checked && wasOn.includes(s.permission) && (
                <p className="flex items-start gap-1 text-xs text-[var(--warn)]">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  {t("Its data is kept {n} days, with a copy in the backup folder, then deleted.", { n: days })}
                </p>
              )}
              {pending && !checked && (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  {t("Off — data deleted on {date}", { date: dateOnly(pending.wipeAt) })}
                  {pending.size !== undefined && (
                    <a href={`/api/backups/${encodeURIComponent(pending.archive)}`} className="flex items-center gap-1 text-accent hover:underline">
                      <Download className="h-3 w-3" /> {t("Archive")}
                    </a>
                  )}
                </p>
              )}
              {pending && checked && <p className="text-xs text-muted">{t("Turned back on when you save: nothing is deleted.")}</p>}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">{t("Unchecked apps are hidden for everyone, admins included.")}</p>
    </fieldset>
  );
}
