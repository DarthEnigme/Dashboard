"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronDown, NotebookText, Pencil, Plus } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { Markdown } from "../settings/Markdown";
import { useT } from "@/i18n/client";

export type RunbookAnswer = { notes: { id: number; title: string; body: string; updated_at: number }[]; canEdit: boolean };

/** Shared with the maintenance menu, which links to the first runbook. */
export const runbookKey = (serviceId: string) => `/api/notes/for-service/${encodeURIComponent(serviceId)}`;

/** The notes linked to a service, on its page. Long ones start folded. */
export function Runbook({ serviceId }: { serviceId: string }) {
  const t = useT();
  const { data } = useSWR<RunbookAnswer>(runbookKey(serviceId), fetcher, { shouldRetryOnError: false });
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (!data) return null;
  if (!data.notes.length) {
    if (!data.canEdit) return null;
    return (
      <Link href={`/notes?service=${encodeURIComponent(serviceId)}`} className="flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
        <Plus className="h-4 w-4" /> {t("Write a runbook for this service")}
      </Link>
    );
  }
  return (
    <section className="glass flex flex-col gap-3 rounded-3xl p-5" aria-labelledby="runbook-title" id="runbook">
      <h2 id="runbook-title" className="flex items-center gap-2 text-sm font-semibold tracking-wider text-muted uppercase">
        <NotebookText className="h-4 w-4" /> {t("Runbook")}
      </h2>
      {data.notes.map((n, i) => {
        const long = n.body.length > 1200 || n.body.split("\n").length > 25;
        const expanded = open[n.id] ?? (i === 0 && !long);
        return (
          <div key={n.id} data-runbook={n.title} className="flex flex-col gap-2 border-t border-line pt-3 first-of-type:border-0 first-of-type:pt-0">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setOpen({ ...open, [n.id]: !expanded })} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-semibold">
                <ChevronDown className={`h-4 w-4 shrink-0 transition ${expanded ? "" : "-rotate-90"}`} />
                <span className="truncate">{n.title}</span>
              </button>
              {data.canEdit && (
                <Link href={`/notes?note=${n.id}`} aria-label={t("Edit {name} in Notes", { name: n.title })} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg">
                  <Pencil className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
            {expanded && <Markdown text={n.body} rich />}
          </div>
        );
      })}
    </section>
  );
}
