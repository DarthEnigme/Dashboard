"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertTriangle, ArrowLeft, Link2, NotebookText, Plus, Search, X } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Note, NoteSummary } from "@/lib/notes/store";
import { dateTime } from "@/i18n/format";
import { useT } from "@/i18n/client";
import { Markdown } from "../settings/Markdown";
import { DeleteButton } from "../edit/controls";
import { inputBase, inputClass } from "../edit/FieldInput";

type ServiceRef = { id: string; name: string; group: string };
type ListAnswer = { notes: NoteSummary[]; services: ServiceRef[] };
type Draft = { id?: number; title: string; body: string; services: string[] };

const KEY = "/api/notes";
const TEMPLATE = "## When to use this\n\n## Steps\n1. \n2. \n\n## Check it worked\n- [ ] \n";

/** Notes and runbooks: Markdown pages, linked to the services they are about. */
export function NotesPage({ openId, forService }: { openId?: number; forService?: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const { data, mutate } = useSWR<ListAnswer>(`${KEY}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, fetcher, { keepPreviousData: true });
  const [selected, setSelected] = useState<number | "new" | undefined>(forService ? "new" : openId);
  const services = useMemo(() => new Map((data?.services ?? []).map((s) => [s.id, s])), [data?.services]);

  // Without a choice, open the newest note.
  useEffect(() => {
    if (selected === undefined && data?.notes.length) setSelected(data.notes[0].id);
  }, [data, selected]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {t("Dashboard")}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("Notes")}</h1>
          <p className="text-muted">{t("Runbooks, how-tos and anything worth writing down. Link a note to services to show it on their pages.")}</p>
        </div>
        <button type="button" onClick={() => setSelected("new")} className="flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:brightness-110">
          <Plus className="h-4 w-4" /> {t("New note")}
        </button>
      </header>

      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <aside className="glass flex flex-col gap-2 self-start rounded-3xl p-3">
          <label className="flex h-9 items-center gap-1.5 rounded-full bg-chip px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search notes…")} aria-label={t("Search notes")} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
          <ul className="flex flex-col">
            {data?.notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setSelected(n.id)}
                  aria-current={selected === n.id}
                  data-note={n.title}
                  className="flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-hover aria-[current=true]:bg-chip"
                >
                  <span className="truncate text-sm font-medium">{n.title}</span>
                  <span className="truncate text-xs text-muted">
                    {n.services.length ? n.services.map((s) => services.get(s)?.name ?? s).join(", ") : dateTime(n.updated_at)}
                  </span>
                </button>
              </li>
            ))}
            {data && !data.notes.length && <li className="px-3 py-6 text-center text-sm text-muted">{q ? t("No note matches.") : t("No notes yet.")}</li>}
          </ul>
        </aside>

        {selected === "new" ? (
          <Editor
            key={`new-${forService ?? ""}`}
            initial={{ title: "", body: TEMPLATE, services: forService ? [forService] : [] }}
            services={data?.services ?? []}
            onSaved={async (n) => {
              await mutate();
              setSelected(n.id);
            }}
            onCancel={() => setSelected(data?.notes[0]?.id)}
          />
        ) : selected !== undefined ? (
          <NoteView
            key={selected}
            id={selected}
            services={data?.services ?? []}
            onChanged={() => mutate()}
            onDeleted={async () => {
              await mutate();
              setSelected(undefined);
            }}
          />
        ) : (
          <section className="glass grid place-items-center rounded-3xl p-10 text-center text-sm text-muted">
            <NotebookText className="mb-2 h-8 w-8" />
            {t("Write your first note: how to restart the NAS, where the router password is kept…")}
          </section>
        )}
      </div>
    </main>
  );
}

function NoteView({ id, services, onChanged, onDeleted }: { id: number; services: ServiceRef[]; onChanged: () => void; onDeleted: () => void }) {
  const t = useT();
  const { data: note, mutate, error } = useSWR<Note>(`${KEY}/${id}`, fetcher);
  const [editing, setEditing] = useState(false);
  if (error) return <p className="text-[var(--err)]">{(error as Error).message}</p>;
  if (!note) return null;
  if (editing)
    return (
      <Editor
        initial={note}
        services={services}
        onSaved={async (n) => {
          await mutate(n as Note, { revalidate: false });
          onChanged();
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  const byId = new Map(services.map((s) => [s.id, s]));
  return (
    <article className="glass flex flex-col gap-3 rounded-3xl p-5">
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">{note.title}</h2>
        <button type="button" onClick={() => setEditing(true)} className="rounded-full bg-chip px-4 py-1.5 text-sm hover:bg-hover">
          {t("Edit")}
        </button>
        <DeleteButton
          label={t("Delete {name}", { name: note.title })}
          onConfirm={async () => {
            await sendJson(`${KEY}/${note.id}`, "DELETE");
            onDeleted();
          }}
        />
      </div>
      {note.services.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {note.services.map((s) => {
            const svc = byId.get(s);
            return svc ? (
              <Link key={s} href={`/service/${encodeURIComponent(s)}`} className="flex items-center gap-1 rounded-full bg-chip px-2.5 py-1 hover:bg-hover">
                <Link2 className="h-3 w-3" /> {svc.name}
              </Link>
            ) : (
              <span key={s} className="flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] px-2.5 py-1 text-[var(--warn)]" title={t("No service has this id any more (renamed?). Edit the note to link it again.")}>
                <AlertTriangle className="h-3 w-3" /> {s}
              </span>
            );
          })}
        </div>
      )}
      <Markdown text={note.body || "*" + t("Empty note") + "*"} rich />
      <p className="text-xs text-muted">{t("Last edited {date} by {name}", { date: dateTime(note.updated_at), name: note.updated_by ?? "?" })}</p>
    </article>
  );
}

function Editor({ initial, services, onSaved, onCancel }: { initial: Draft; services: ServiceRef[]; onSaved: (n: NoteSummary) => void; onCancel: () => void }) {
  const t = useT();
  const [d, setD] = useState<Draft>(initial);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const known = new Set(services.map((s) => s.id));
  const free = services.filter((s) => !d.services.includes(s.id));

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const body = { title: d.title, body: d.body, services: d.services };
      onSaved(await sendJson<Note>(initial.id ? `${KEY}/${initial.id}` : KEY, initial.id ? "PUT" : "POST", body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="glass flex flex-col gap-3 rounded-3xl p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-label={initial.id ? t("Edit note") : t("New note")}
    >
      <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder={t("Title")} aria-label={t("Title")} maxLength={200} className={`${inputClass} text-lg font-semibold`} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted">{t("Shown on:")}</span>
        {d.services.map((s) => (
          <span key={s} className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${known.has(s) ? "bg-chip" : "bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-[var(--warn)]"}`}>
            {known.has(s) ? services.find((x) => x.id === s)!.name : t("{id} (unknown service, re-link)", { id: s })}
            <button type="button" onClick={() => setD({ ...d, services: d.services.filter((x) => x !== s) })} aria-label={t("Unlink {name}", { name: s })} className="rounded-full hover:text-fg">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <select
          aria-label={t("Link to a service")}
          value=""
          onChange={(e) => e.target.value && setD({ ...d, services: [...d.services, e.target.value] })}
          className={`${inputBase} h-7 w-48 py-0 text-xs`}
        >
          <option value="">{t("Link to a service…")}</option>
          {free.map((s) => (
            <option key={s.id} value={s.id}>
              {s.group} › {s.name}
            </option>
          ))}
        </select>
      </div>
      <p className="-mt-1 text-xs text-muted">{t("A linked note shows on the service's page to everyone who can see that service.")}</p>
      <div className="flex w-fit rounded-full bg-chip p-0.5 text-sm" role="tablist">
        {(["write", "preview"] as const).map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={`rounded-full px-3 py-1 ${tab === x ? "bg-accent text-white" : "text-muted hover:text-fg"}`}>
            {x === "write" ? t("Write") : t("Preview")}
          </button>
        ))}
      </div>
      {tab === "write" ? (
        <textarea
          value={d.body}
          onChange={(e) => setD({ ...d, body: e.target.value })}
          rows={18}
          aria-label={t("Text (Markdown)")}
          className={`${inputClass} h-auto py-2 font-mono text-sm`}
          spellCheck
        />
      ) : (
        <div className="min-h-40 rounded-xl bg-chip/50 p-4">
          <Markdown text={d.body} rich />
        </div>
      )}
      <p className="text-xs text-muted">{t("Markdown: # headings, **bold**, *italic*, `code`, ``` code blocks, lists, 1. steps, - [ ] checklists, > quotes and [links](https://…).")}</p>
      {error && <p role="alert" className="text-sm text-[var(--err)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-hover">
          {t("Cancel")}
        </button>
        <button type="submit" disabled={busy || !d.title.trim()} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40">
          {t("Save")}
        </button>
      </div>
    </form>
  );
}
