"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, Trash2 } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import { IMPACTS, INCIDENT_STATUSES, type Impact, type IncidentStatus } from "@/lib/incidentKinds";
import type { PostedIncident } from "@/lib/statusIncidents";
import { dateTime } from "@/i18n/format";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { Dialog } from "./edit/Dialog";
import { DeleteButton } from "./edit/controls";
import { inputBase, inputClass } from "./edit/FieldInput";
import { Markdown } from "./settings/Markdown";

const KEY = "/api/status-incidents";
export const STATUS_LABELS: Record<IncidentStatus, string> = { investigating: msg("Investigating"), identified: msg("Identified"), monitoring: msg("Monitoring"), resolved: msg("Resolved") };
const IMPACT_LABELS: Record<Impact, string> = { minor: msg("Minor"), major: msg("Major"), maintenance: msg("Maintenance") };
type ServiceRef = { id: string; name: string };

/**
 * Admins: incidents for the public status page. Post one (title, impact, services, first update),
 * then add updates as things change until it is resolved. `service` pre-selects a service.
 */
export function IncidentsDialog({ services, service, onClose }: { services: ServiceRef[]; service?: string; onClose: () => void }) {
  const t = useT();
  const { data, mutate } = useSWR<PostedIncident[]>(KEY, fetcher);
  const [f, setF] = useState({ title: "", impact: "minor" as Impact, status: "investigating" as IncidentStatus, body: "", services: service ? [service] : ([] as string[]) });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const names = new Map(services.map((s) => [s.id, s.name]));

  const post = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await sendJson(KEY, "POST", f);
      await mutate();
      setF({ title: "", impact: "minor", status: "investigating", body: "", services: [] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("Status page incidents")} onClose={onClose} onSubmit={() => void post()} submitLabel={t("Post incident")} error={error} busy={busy || !f.title.trim()}>
      {data?.map((i) => (
        <IncidentRow key={i.id} incident={i} names={names} onChanged={() => mutate()} />
      ))}
      {data && !data.length && <p className="text-sm text-muted">{t("No incidents in the last 30 days.")}</p>}

      <fieldset className="flex flex-col gap-2 border-t border-line pt-4">
        <legend className="mb-2 text-sm font-semibold">{t("New incident")}</legend>
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t("What is going on? e.g. Photos are slow to load")} aria-label={t("Incident title")} className={inputClass} />
        <div className="flex flex-wrap gap-2">
          <select aria-label={t("Impact")} value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value as Impact })} className={`${inputBase} w-36`}>
            {IMPACTS.map((x) => (
              <option key={x} value={x}>
                {t(IMPACT_LABELS[x])}
              </option>
            ))}
          </select>
          <select aria-label={t("Status")} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as IncidentStatus })} className={`${inputBase} w-40`}>
            {INCIDENT_STATUSES.map((x) => (
              <option key={x} value={x}>
                {t(STATUS_LABELS[x])}
              </option>
            ))}
          </select>
          <select
            aria-label={t("Add a service")}
            value=""
            onChange={(e) => e.target.value && setF({ ...f, services: [...f.services, e.target.value] })}
            className={`${inputBase} min-w-40 flex-1`}
          >
            <option value="">{t("Services affected…")}</option>
            {services
              .filter((s) => !f.services.includes(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        {f.services.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {f.services.map((s) => (
              <button key={s} type="button" onClick={() => setF({ ...f, services: f.services.filter((x) => x !== s) })} className="rounded-full bg-chip px-2.5 py-1 hover:bg-hover" aria-label={t("Remove {name}", { name: names.get(s) ?? s })}>
                {names.get(s) ?? s} ×
              </button>
            ))}
          </div>
        )}
        <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={3} placeholder={t("What visitors should know (Markdown)")} aria-label={t("First update")} className={`${inputClass} h-auto py-2`} />
        <p className="text-xs text-muted">{t("Shown on the public status page (if it is on) for the services listed there. Visitors never see who posted it.")}</p>
      </fieldset>
    </Dialog>
  );
}

function IncidentRow({ incident: i, names, onChanged }: { incident: PostedIncident; names: Map<string, string>; onChanged: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(i.resolved_at === null);
  const [status, setStatus] = useState<IncidentStatus>(i.status);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const run = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const update = async () => {
    if (await run(() => sendJson(`${KEY}/${i.id}`, "POST", { status, body }))) setBody("");
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-chip p-3" data-incident={i.title}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold">
          <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "" : "-rotate-90"}`} />
          <span className="truncate">{i.title}</span>
        </button>
        <span className={`rounded-full px-2 py-0.5 text-xs ${i.resolved_at === null ? "bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-[var(--warn)]" : "bg-track text-muted"}`}>{t(STATUS_LABELS[i.status])}</span>
        <DeleteButton label={t("Delete {name}", { name: i.title })} onConfirm={() => run(() => sendJson(`${KEY}/${i.id}`, "DELETE"))} />
      </div>
      {open && (
        <>
          {i.services.length > 0 && <p className="text-xs text-muted">{i.services.map((s) => names.get(s) ?? s).join(", ")}</p>}
          <ol className="flex flex-col gap-2 border-l border-line pl-3">
            {i.updates.map((u) => (
              <li key={u.id} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 text-xs text-muted">
                  <strong className="font-semibold text-fg">{t(STATUS_LABELS[u.status])}</strong> · {dateTime(u.at)} {u.by && `· ${u.by}`}
                  {i.updates.length > 1 && (
                    <button type="button" onClick={() => run(() => sendJson(`${KEY}/${i.id}?update=${u.id}`, "DELETE"))} aria-label={t("Delete this update")} className="ml-auto rounded p-0.5 hover:text-fg">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </span>
                {u.body && <Markdown text={u.body} />}
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <select aria-label={t("New status")} value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)} className={`${inputBase} w-40`}>
                {INCIDENT_STATUSES.map((x) => (
                  <option key={x} value={x}>
                    {t(STATUS_LABELS[x])}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void update()} disabled={!body.trim() && status === i.status} className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
                {t("Add update")}
              </button>
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={t("What changed?")} aria-label={t("Update for {name}", { name: i.title })} className={`${inputClass} h-auto py-2`} />
          </div>
          {error && <p className="text-xs text-[var(--err)]">{error}</p>}
        </>
      )}
    </div>
  );
}
