"use client";

import { useState } from "react";
import { PRIORITIES, type Board, type Priority, type Task } from "@/lib/tasks/types";
import type { NewTask, TaskDraft } from "./model";
import { useT } from "@/i18n/client";
import { Dialog } from "../edit/Dialog";
import { DeleteButton } from "../edit/controls";
import { inputClass } from "../edit/FieldInput";
import { Markdown } from "../settings/Markdown";
import { PRIORITY_LABELS } from "./meta";
import { TaskTitle } from "./TaskCard";

interface Props {
  /** The task to edit, or where a new one starts. */
  task: Task | NewTask;
  board: Board;
  /** Labels already used on the board, offered as suggestions. */
  labels: string[];
  onSave: (draft: TaskDraft) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

const label = "flex flex-col gap-1.5 text-xs font-medium text-muted";

export function TaskDialog({ task, board, labels, onSave, onDelete, onClose }: Props) {
  const t = useT();
  const existing = "id" in task ? task : undefined;
  const [draft, setDraft] = useState({
    column: task.column_id,
    lane: task.lane_id,
    blocked_by: existing?.blocked_by ?? [],
    title: existing?.title ?? "",
    body: existing?.body ?? "",
    priority: existing?.priority ?? (0 as Priority),
    due: existing?.due ?? "",
    labels: existing?.labels.join(", ") ?? "",
  });
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const save = () =>
    run(() =>
      onSave({
        id: existing?.id,
        column: draft.column,
        lane: draft.lane,
        title: draft.title,
        body: draft.body,
        priority: draft.priority,
        due: draft.due || null,
        labels: draft.labels,
        blocked_by: draft.blocked_by,
      }),
    );
  const others = board.columns.flatMap((c) => c.tasks).filter((x) => x.id !== existing?.id);

  return (
    <Dialog title={existing ? t("Edit task") : t("New task")} onClose={onClose} onSubmit={save} error={error} busy={busy}>
      <label className={label}>
        {t("Title")}
        <input autoFocus required maxLength={200} value={draft.title} onChange={(e) => set("title", e.target.value)} className={inputClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          {t("Column")}
          <select value={draft.column} onChange={(e) => set("column", Number(e.target.value))} className={inputClass}>
            {board.columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t("Priority")}
          <select value={draft.priority} onChange={(e) => set("priority", Number(e.target.value) as Priority)} className={inputClass}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(PRIORITY_LABELS[p])}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t("Due date")}
          <input type="date" value={draft.due} onChange={(e) => set("due", e.target.value)} className={inputClass} />
        </label>
      </div>
      {board.lanes.length > 0 && (
        <label className={label}>
          {t("Lane")}
          <select value={draft.lane ?? ""} onChange={(e) => set("lane", e.target.value ? Number(e.target.value) : null)} className={inputClass}>
            <option value="">{t("No lane")}</option>
            {board.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {board.project && others.length > 0 && <BlockedBy tasks={others} value={draft.blocked_by} onChange={(v) => set("blocked_by", v)} />}
      <label className={label}>
        {t("Labels (comma-separated)")}
        <input value={draft.labels} onChange={(e) => set("labels", e.target.value)} list="task-labels" placeholder={t("home, urgent")} className={inputClass} />
        <datalist id="task-labels">
          {labels.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </label>
      <div className={label}>
        <div className="flex items-center justify-between">
          <label htmlFor="task-notes">{t("Notes (Markdown)")}</label>
          {draft.body && (
            <button type="button" onClick={() => setPreview((p) => !p)} className="rounded-full px-2 py-0.5 text-accent hover:bg-hover">
              {preview ? t("Edit") : t("Preview")}
            </button>
          )}
        </div>
        {preview ? (
          <div className="rounded-xl border border-line p-3 text-sm font-normal text-fg">
            <Markdown text={draft.body} rich />
          </div>
        ) : (
          <textarea id="task-notes" rows={6} value={draft.body} onChange={(e) => set("body", e.target.value)} className={`${inputClass} font-normal`} />
        )}
      </div>
      {existing && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <DeleteButton label={t("Delete task")} onConfirm={() => run(() => onDelete(existing.id))} />
          {t("Delete this task")}
        </div>
      )}
    </Dialog>
  );
}

/** The tasks this one waits for: it can't be finished before them. */
function BlockedBy({ tasks, value, onChange }: { tasks: Task[]; value: number[]; onChange: (v: number[]) => void }) {
  const t = useT();
  const chosen = new Set(value);
  return (
    <fieldset className={label}>
      <legend className="mb-1.5">{t("Waits for")}</legend>
      <div className="flex max-h-36 flex-col gap-0.5 overflow-y-auto rounded-xl border border-line p-1.5">
        {tasks.map((x) => (
          <label key={x.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-normal text-fg hover:bg-hover">
            <input type="checkbox" checked={chosen.has(x.id)} onChange={(e) => onChange(e.target.checked ? [...value, x.id] : value.filter((id) => id !== x.id))} />
            <TaskTitle task={x} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
