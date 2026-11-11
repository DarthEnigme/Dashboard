"use client";

import { BellRing, Columns3, FolderKanban, List, Pencil, Plus, Search, Settings2, Workflow, type LucideIcon } from "lucide-react";
import { PRIORITIES, type Board, type Priority, type TasksData } from "@/lib/tasks/types";
import { msg } from "@/i18n";
import { useT } from "@/i18n/client";
import { DeleteButton, IconButton } from "../edit/controls";
import { inputBase } from "../edit/FieldInput";
import { Menu, menuItem } from "../edit/Menu";
import { PRIORITY_LABELS, type Filter } from "./meta";
import type { Naming } from "./model";

export type View = "board" | "list" | "workflow";

/** The ways to look at a board; the workflow only means something in project mode. */
const VIEWS: { id: View; icon: LucideIcon; label: string; project?: true }[] = [
  { id: "board", icon: Columns3, label: msg("Board") },
  { id: "list", icon: List, label: msg("List") },
  { id: "workflow", icon: Workflow, label: msg("Workflow"), project: true },
];
export const VIEW_IDS = VIEWS.map((v) => v.id);
export const viewsFor = (board: Pick<Board, "project">) => VIEWS.filter((v) => !v.project || board.project).map((v) => v.id);

interface Props {
  data: TasksData;
  filter: Filter;
  onFilter: (f: Filter) => void;
  view: View;
  onView: (v: View) => void;
  onBoard: (id: number) => void;
  onName: (n: Naming) => void;
  onChangeBoard: (patch: { project?: boolean; notify?: boolean }) => void;
  onDeleteBoard: () => void;
}

/** Above the board: which board, what it does, what to show of it and how. */
export function Toolbar({ data, filter, onFilter, view, onView, onBoard, onName, onChangeBoard, onDeleteBoard }: Props) {
  const t = useT();
  const { board } = data;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={board.id} onChange={(e) => onBoard(Number(e.target.value))} aria-label={t("Board")} className={`${inputBase} w-48 font-medium`}>
        {data.boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <IconButton label="Rename board" onClick={() => onName({ what: "board", id: board.id, name: board.name })}>
        <Pencil className="h-4 w-4" />
      </IconButton>
      <IconButton label="New board" onClick={() => onName({ what: "board", name: "" })}>
        <Plus className="h-4 w-4" />
      </IconButton>
      <BoardMenu data={data} onChangeBoard={onChangeBoard} />
      {data.boards.length > 1 && <DeleteButton label={t("Delete board")} onConfirm={onDeleteBoard} />}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input type="search" value={filter.text} onChange={(e) => onFilter({ ...filter, text: e.target.value })} placeholder={t("Filter tasks…")} aria-label={t("Filter tasks…")} className={`${inputBase} w-44 pl-9`} />
        </label>
        {data.labels.length > 0 && (
          <select value={filter.label ?? ""} onChange={(e) => onFilter({ ...filter, label: e.target.value || undefined })} aria-label={t("Label")} className={`${inputBase} w-36`}>
            <option value="">{t("All labels")}</option>
            {data.labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}
        <select
          value={filter.priority ?? ""}
          onChange={(e) => onFilter({ ...filter, priority: e.target.value === "" ? undefined : (Number(e.target.value) as Priority) })}
          aria-label={t("Priority")}
          className={`${inputBase} w-36`}
        >
          <option value="">{t("Any priority")}</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {t(PRIORITY_LABELS[p])}
            </option>
          ))}
        </select>
        <div className="glass flex rounded-full p-1" role="group" aria-label={t("View")}>
          {VIEWS.filter((v) => viewsFor(board).includes(v.id)).map(({ id, icon: Icon, label }) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-muted hover:text-fg aria-pressed:bg-accent aria-pressed:text-white">
              <Icon className="h-4 w-4" /> {t(label)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The board's own settings: project mode and reminders. */
function BoardMenu({ data, onChangeBoard }: Pick<Props, "data" | "onChangeBoard">) {
  const t = useT();
  const { board } = data;
  return (
    <Menu label={t("Board options")} width="w-72" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-fg" button={<Settings2 className="h-4 w-4" />}>
      {(close) => {
        const act = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <button type="button" role="menuitemcheckbox" aria-checked={board.project} className={menuItem} onClick={act(() => onChangeBoard({ project: !board.project }))}>
              <FolderKanban className={`h-4 w-4 ${board.project ? "text-accent" : "text-muted"}`} />
              <span className="flex flex-col">
                {t("Project mode")}
                <span className="text-xs text-muted">{t("Tasks wait for one another; see the steps and progress.")}</span>
              </span>
            </button>
            <button type="button" role="menuitemcheckbox" aria-checked={board.notify} disabled={!data.alerts && !board.notify} className={menuItem} onClick={act(() => onChangeBoard({ notify: !board.notify }))}>
              <BellRing className={`h-4 w-4 ${board.notify ? "text-accent" : "text-muted"}`} />
              <span className="flex flex-col">
                {t("Send reminders to the alert channels")}
                <span className="text-xs text-muted">{data.alerts ? t("Due and overdue tasks of this board, once each.") : t("Set up an alert channel in the settings first.")}</span>
              </span>
            </button>
          </>
        );
      }}
    </Menu>
  );
}
