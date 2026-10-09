"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Activity, Check, Container, EyeOff, FileUp, History, LayoutGrid, Pencil, Plus, Puzzle, Settings2, Undo2, Users } from "lucide-react";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { Bookmark, ConfigFile } from "@/lib/config/schema";
import { infoFields } from "@/info/fields";
import { integrationFields, type FieldSpec } from "@/integrations/fields";
import { Icon } from "../Icon";
import { SortableList } from "./SortableList";
import { FieldsDialog } from "./FieldsDialog";
import { ServiceDialog, type RawService } from "./ServiceDialog";
import { InfoDialog, type RawInfoWidget } from "./InfoDialog";
import { UsersPanel } from "./UsersPanel";
import { HistoryPanel } from "./HistoryPanel";
import { ImportDialog } from "./ImportDialog";
import { visibleField } from "./fields";
import { DeleteButton, EmptyAdd, IconButton, ToolButton } from "./controls";
import { LiveReload } from "../LiveReload";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n";

// Editor-only keys (prefixed "_") are ignored by the server when writing YAML.
type Meta = { _key: string; _orig?: string };
type EService = RawService & Meta;
type EGroup = Meta & { name: string; columns?: number; services: EService[]; [k: string]: unknown };
type ELink = Bookmark & Meta;
type EBGroup = Meta & { name: string; links: ELink[]; [k: string]: unknown };
type EInfo = RawInfoWidget & Meta;
type Discovered = { group: string; name: string; icon?: string };
type Raw = {
  settings: Record<string, unknown>;
  services: EGroup[];
  bookmarks: EBGroup[];
  widgets: EInfo[];
  discovered: Discovered[];
};

type DialogState =
  | { kind: "group"; gi?: number }
  | { kind: "service"; gi: number; si?: number }
  | { kind: "bgroup"; gi?: number }
  | { kind: "link"; gi: number; li?: number }
  | { kind: "info"; i?: number };

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

/** Add stable React/dnd keys, and remember each item's name as it is in the file. */
function withMeta<T>(v: T): T {
  if (Array.isArray(v)) return v.map(withMeta) as T;
  if (v && typeof v === "object") {
    const o = Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, k === "widget" || k === "background" ? x : withMeta(x)]),
    );
    if (typeof o.name === "string") Object.assign(o, { _key: newKey(), _orig: o.name });
    return o as T;
  }
  return v;
}

/** After a successful write the file holds the new names. */
function syncOrig<T>(v: T): T {
  if (Array.isArray(v)) return v.map(syncOrig) as T;
  if (v && typeof v === "object" && "_key" in v) {
    const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) ? syncOrig(x) : x]));
    return { ...o, _orig: o.name } as T;
  }
  return v;
}

const replaceAt = <T,>(arr: T[], i: number | undefined, item: T) =>
  i === undefined ? [...arr, item] : arr.map((x, j) => (j === i ? item : x));
const removeAt = <T,>(arr: T[], i: number) => arr.filter((_, j) => j !== i);

const tabField: FieldSpec = { key: "tab", label: msg("Tab"), placeholder: msg("Home"), help: msg("Leave empty for the first tab.") };
const groupFields: FieldSpec[] = [
  { key: "name", label: msg("Group name"), required: true },
  tabField,
  { key: "collapsed", label: msg("Collapsed by default"), kind: "boolean" },
  visibleField,
  { key: "columns", label: msg("Columns"), kind: "number", help: msg("Overrides the global setting for this group.") },
];
const bgroupFields: FieldSpec[] = [{ key: "name", label: msg("Group name"), required: true }, tabField, visibleField];
const linkFields: FieldSpec[] = [
  { key: "name", label: msg("Name"), required: true },
  { key: "href", label: "URL", required: true, placeholder: "https://" },
  { key: "icon", label: msg("Icon"), placeholder: msg("github, mdi-book, si-github or a URL") },
  { key: "description", label: msg("Description") },
];

type Toast = { message: string; error?: boolean; undoFile?: ConfigFile };

export function Editor({ onExit }: { onExit: () => void }) {
  const t = useT();
  const router = useRouter();
  const [raw, setRaw] = useState<Raw>();
  const [loadError, setLoadError] = useState<string>();
  const [toast, setToast] = useState<Toast>();
  const [view, setView] = useState<"layout" | "users" | "history">("layout");
  const [importing, setImporting] = useState(false);
  const [dialog, setDialog] = useState<DialogState>();
  const rawRef = useRef(raw);
  rawRef.current = raw;

  const load = useCallback(async () => {
    try {
      const data = withMeta(await fetcher<Raw>("/api/config?raw=1"));
      // Info widgets have no name to key on.
      setRaw({ ...data, widgets: data.widgets.map((w) => ({ ...w, _key: newKey() })) });
      setLoadError(undefined);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), toast.undoFile ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Optimistically apply, write to disk, and roll back on failure (rethrows for dialogs). */
  const save = async <F extends Exclude<ConfigFile, "settings">>(file: F, next: Raw[F]) => {
    const prev = rawRef.current!;
    const sent = { ...prev, [file]: next } as Raw;
    setRaw(sent);
    try {
      await sendJson("/api/config", "PUT", { file, data: next });
      setRaw((cur) => (cur === sent ? ({ ...cur, [file]: syncOrig(next) } as Raw) : cur));
      setToast({ message: t("Saved"), undoFile: file });
      router.refresh();
    } catch (e) {
      setRaw((cur) => (cur === sent ? prev : cur));
      throw e;
    }
  };
  const saveQuiet = (...args: Parameters<typeof save>) =>
    save(...args).catch((e) => setToast({ message: (e as Error).message, error: true }));

  /** One-step undo: restore the snapshot taken right before the last save of this file. */
  const undo = async (file: ConfigFile) => {
    try {
      const [latest] = await fetcher<{ id: number }[]>(`/api/config/history?file=${file}`);
      if (!latest) throw new Error(t("Nothing to undo"));
      await sendJson(`/api/config/history/${latest.id}`, "POST");
      await load();
      router.refresh();
      setToast({ message: t("Change undone") });
    } catch (e) {
      setToast({ message: (e as Error).message, error: true });
    }
  };


  if (loadError) {
    return (
      <div className="glass mx-auto max-w-md rounded-2xl p-6 text-center">
        <p className="mb-4">{t("Couldn’t load config for editing:")}{" "}{loadError}</p>
        <button onClick={onExit} className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white">{t("Back")}</button>
      </div>
    );
  }
  if (!raw) return <div className="glass mx-auto h-24 max-w-md animate-pulse rounded-2xl" />;

  const { services, bookmarks, widgets, discovered } = raw;

  return (
    <div className="flex flex-col gap-8">
      <LiveReload paused onReload={() => void load()} />
      <div className="glass sticky top-3 z-20 flex flex-wrap items-center gap-2 rounded-2xl p-3">
        <div className="mr-auto px-2">
          <div className="font-semibold">{t("Editing")}</div>
          <div className="text-xs text-muted">{t("Changes are written to the YAML files in your config folder.")}</div>
        </div>
        <div className="flex rounded-full bg-chip p-1" role="tablist" aria-label={t("Editor sections")}>
          {(
            [
              ["layout", t("Layout"), <LayoutGrid key="l" className="h-4 w-4" />],
              ["users", t("Users"), <Users key="u" className="h-4 w-4" />],
              ["history", t("History"), <History key="h" className="h-4 w-4" />],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${view === v ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        {view === "layout" && (
          <>
            <ToolButton onClick={() => router.push("/settings")} icon={<Settings2 className="h-4 w-4" />}>{t("Settings")}</ToolButton>
            <ToolButton onClick={() => setDialog({ kind: "info" })} icon={<Plus className="h-4 w-4" />}>{t("Info widget")}</ToolButton>
            <ToolButton onClick={() => setDialog({ kind: "group" })} icon={<Plus className="h-4 w-4" />}>{t("Service group")}</ToolButton>
            <ToolButton onClick={() => setDialog({ kind: "bgroup" })} icon={<Plus className="h-4 w-4" />}>{t("Bookmark group")}</ToolButton>
            <ToolButton onClick={() => setImporting(true)} icon={<FileUp className="h-4 w-4" />}>{t("Import")}</ToolButton>
          </>
        )}
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/30 hover:brightness-110"
        >
          <Check className="h-4 w-4" /> {t("Done")}
        </button>
      </div>

      {view === "users" && <UsersPanel />}
      {view === "history" && (
        <HistoryPanel
          onRestored={async () => {
            await load();
            router.refresh();
          }}
        />
      )}

      {view === "layout" && (
      <>
      <section>
        <h2 className="mb-3 px-1 text-sm font-semibold tracking-wider text-muted uppercase">{t("Info bar")}</h2>
        <SortableList
          items={widgets}
          layout="grid"
          onReorder={(next) => saveQuiet("widgets", next)}
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-3"
        >
          {(w, i, handle) => (
            <div className="glass flex items-center gap-2 rounded-2xl p-2.5">
              {handle}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {infoFields[w.type]?.label ?? w.type}
                {typeof w.label === "string" && <span className="text-muted"> · {String(w.label)}</span>}
              </span>
              <IconButton label={t("Edit widget")} onClick={() => setDialog({ kind: "info", i })}>
                <Pencil className="h-3.5 w-3.5" />
              </IconButton>
              <DeleteButton label={t("Delete widget")} onConfirm={() => saveQuiet("widgets", removeAt(widgets, i))} />
            </div>
          )}
        </SortableList>
        {!widgets.length && (
          <EmptyAdd onClick={() => setDialog({ kind: "info" })}>{t("Add a clock, weather, resources or markets widget")}</EmptyAdd>
        )}
      </section>

      <section>
        <h2 className="mb-3 px-1 text-sm font-semibold tracking-wider text-muted uppercase">{t("Services")}</h2>
        <SortableList items={services} onReorder={(next) => saveQuiet("services", next)} className="flex flex-col gap-4">
          {(group, gi, handle) => (
            <div className="glass rounded-2xl p-4">
              <PanelHeader
                handle={handle}
                title={group.name}
                badge={[group.tab, group.visible && group.visible !== "public" ? t("{who} only", { who: String(group.visible) }) : undefined].filter(Boolean).join(" · ") || undefined}
                onAdd={() => setDialog({ kind: "service", gi })}
                addLabel={t("Add service")}
                onEdit={() => setDialog({ kind: "group", gi })}
                onDelete={() => saveQuiet("services", removeAt(services, gi))}
              />
              {group.services.length ? (
                <SortableList
                  items={group.services}
                  layout="grid"
                  className="svc-grid mt-3"
                  onReorder={(next) => saveQuiet("services", replaceAt(services, gi, { ...group, services: next }))}
                >
                  {(s, si, sHandle) => (
                    <div className="flex items-center gap-2.5 rounded-xl bg-chip p-2.5 ring-1 ring-chip-ring ring-inset">
                      {sHandle}
                      <Icon icon={s.icon} name={s.name} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{s.name}</div>
                        <div className="flex items-center gap-2 text-[11px] text-muted">
                          {s.ping ? <Activity className="h-3 w-3" aria-label={t("Status check on")} /> : null}
                          {typeof s.size === "string" && s.size !== "small" ? <span>{s.size}</span> : null}
                          {s.visible && s.visible !== "public" ? (
                            <span className="flex items-center gap-1" title={t("Visible to {who}", { who: String(s.visible) })}>
                              <EyeOff className="h-3 w-3" />
                              {String(s.visible)}
                            </span>
                          ) : null}
                          {s.widget && (
                            <span className="flex items-center gap-1">
                              <Puzzle className="h-3 w-3" />
                              {integrationFields[s.widget.type]?.label ?? s.widget.type}
                            </span>
                          )}
                        </div>
                      </div>
                      <IconButton label={t("Edit service")} onClick={() => setDialog({ kind: "service", gi, si })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <DeleteButton
                        label={t("Delete service")}
                        onConfirm={() =>
                          saveQuiet("services", replaceAt(services, gi, { ...group, services: removeAt(group.services, si) }))
                        }
                      />
                    </div>
                  )}
                </SortableList>
              ) : (
                <EmptyAdd onClick={() => setDialog({ kind: "service", gi })}>{t("Add a service")}</EmptyAdd>
              )}
            </div>
          )}
        </SortableList>
        {!services.length && <EmptyAdd onClick={() => setDialog({ kind: "group" })}>{t("Add a service group")}</EmptyAdd>}
        {discovered.length > 0 && (
          <div className="glass mt-4 rounded-2xl p-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <Container className="h-4 w-4" /> {t("From Docker labels")}
            </h3>
            <p className="mb-3 text-xs text-muted">{t("Read-only here: change these with page.* labels on the containers.")}</p>
            <div className="flex flex-wrap gap-2">
              {discovered.map((d) => (
                <span key={`${d.group}|${d.name}`} className="flex items-center gap-2 rounded-xl bg-chip px-2.5 py-1.5 text-sm">
                  <Icon icon={d.icon} name={d.name} size={18} />
                  {d.name}
                  <span className="text-xs text-muted">{d.group}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 px-1 text-sm font-semibold tracking-wider text-muted uppercase">{t("Bookmarks")}</h2>
        <SortableList
          items={bookmarks}
          layout="grid"
          onReorder={(next) => saveQuiet("bookmarks", next)}
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] items-start gap-4"
        >
          {(group, gi, handle) => (
            <div className="glass rounded-2xl p-3">
              <PanelHeader
                handle={handle}
                title={group.name}
                badge={group.tab as string | undefined}
                onAdd={() => setDialog({ kind: "link", gi })}
                addLabel={t("Add bookmark")}
                onEdit={() => setDialog({ kind: "bgroup", gi })}
                onDelete={() => saveQuiet("bookmarks", removeAt(bookmarks, gi))}
              />
              <SortableList
                items={group.links}
                className="mt-2 flex flex-col gap-1"
                onReorder={(next) => saveQuiet("bookmarks", replaceAt(bookmarks, gi, { ...group, links: next }))}
              >
                {(l, li, lHandle) => (
                  <div className="flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-hover">
                    {lHandle}
                    <Icon icon={l.icon} name={l.name} size={20} />
                    <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
                    <IconButton label={t("Edit bookmark")} onClick={() => setDialog({ kind: "link", gi, li })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <DeleteButton
                      label={t("Delete bookmark")}
                      onConfirm={() =>
                        saveQuiet("bookmarks", replaceAt(bookmarks, gi, { ...group, links: removeAt(group.links, li) }))
                      }
                    />
                  </div>
                )}
              </SortableList>
              {!group.links.length && <EmptyAdd onClick={() => setDialog({ kind: "link", gi })}>{t("Add a bookmark")}</EmptyAdd>}
            </div>
          )}
        </SortableList>
        {!bookmarks.length && <EmptyAdd onClick={() => setDialog({ kind: "bgroup" })}>{t("Add a bookmark group")}</EmptyAdd>}
      </section>

      </>
      )}

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={async () => {
            await load();
            router.refresh();
            setToast({ message: t("Homepage config imported. Undo it from History if needed.") });
          }}
        />
      )}

      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={`glass fixed bottom-6 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-4 rounded-2xl px-4 py-3 text-sm ${toast.error ? "text-[var(--err)]" : ""}`}
          style={{ background: "var(--dialog)" }}
        >
          {toast.message}
          {toast.undoFile && (
            <button
              onClick={() => undo(toast.undoFile!)}
              className="flex items-center gap-1.5 rounded-full bg-track px-3 py-1 font-medium hover:bg-hover"
            >
              <Undo2 className="h-4 w-4" /> {t("Undo")}
            </button>
          )}
        </div>
      )}

      {dialog?.kind === "info" && (
        <InfoDialog
          initial={dialog.i === undefined ? undefined : widgets[dialog.i]}
          onClose={() => setDialog(undefined)}
          onSave={(w) => save("widgets", replaceAt(widgets, dialog.i, { _key: newKey(), ...w } as EInfo))}
        />
      )}
      {dialog?.kind === "group" && (
        <FieldsDialog
          title={dialog.gi === undefined ? t("New service group") : t("Edit service group")}
          fields={groupFields}
          initial={dialog.gi === undefined ? { _key: newKey(), services: [] } : services[dialog.gi]}
          onClose={() => setDialog(undefined)}
          onSave={(g) => save("services", replaceAt(services, dialog.gi, g as EGroup))}
        />
      )}
      {dialog?.kind === "service" && (
        <ServiceDialog
          title={dialog.si === undefined ? t("New service in {group}", { group: services[dialog.gi].name }) : t("Edit service")}
          initial={dialog.si === undefined ? ({ _key: newKey(), name: "" } as EService) : services[dialog.gi].services[dialog.si]}
          onClose={() => setDialog(undefined)}
          onSave={(s) => {
            const g = services[dialog.gi];
            return save("services", replaceAt(services, dialog.gi, { ...g, services: replaceAt(g.services, dialog.si, s as EService) }));
          }}
        />
      )}
      {dialog?.kind === "bgroup" && (
        <FieldsDialog
          title={dialog.gi === undefined ? t("New bookmark group") : t("Edit bookmark group")}
          fields={bgroupFields}
          initial={dialog.gi === undefined ? { _key: newKey(), links: [] } : bookmarks[dialog.gi]}
          onClose={() => setDialog(undefined)}
          onSave={(g) => save("bookmarks", replaceAt(bookmarks, dialog.gi, g as EBGroup))}
        />
      )}
      {dialog?.kind === "link" && (
        <FieldsDialog
          title={dialog.li === undefined ? t("New bookmark in {group}", { group: bookmarks[dialog.gi].name }) : t("Edit bookmark")}
          fields={linkFields}
          initial={dialog.li === undefined ? { _key: newKey() } : bookmarks[dialog.gi].links[dialog.li]}
          onClose={() => setDialog(undefined)}
          onSave={(l) => {
            const g = bookmarks[dialog.gi];
            return save("bookmarks", replaceAt(bookmarks, dialog.gi, { ...g, links: replaceAt(g.links, dialog.li, l as ELink) }));
          }}
        />
      )}
    </div>
  );
}

function PanelHeader(props: {
  handle: ReactNode;
  title: string;
  badge?: string;
  onAdd: () => void;
  addLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      {props.handle}
      <h3 className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
        <span className="truncate">{props.title}</span>
        {props.badge && <span className="shrink-0 rounded-full bg-track px-2 py-0.5 text-[11px] font-normal text-muted">{props.badge}</span>}
      </h3>
      <IconButton label={props.addLabel} onClick={props.onAdd}>
        <Plus className="h-4 w-4" />
      </IconButton>
      <IconButton label={t("Edit group")} onClick={props.onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </IconButton>
      <DeleteButton label={t("Delete group")} onConfirm={props.onDelete} />
    </div>
  );
}
