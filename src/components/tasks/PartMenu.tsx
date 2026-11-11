"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, MoreHorizontal, Pencil } from "lucide-react";
import type { Column } from "@/lib/tasks/types";
import { useT } from "@/i18n/client";
import { DeleteButton } from "../edit/controls";
import { Menu, menuItem } from "../edit/Menu";

/** What can be asked of a column or a lane. */
export type PartChange = { rename: true } | { done: boolean } | { shift: -1 | 1 } | { remove: true };

interface Props {
  label: string;
  first: boolean;
  last: boolean;
  /** Columns move left and right, lanes up and down. */
  axis: "x" | "y";
  deleteLabel: string;
  deleteHint: string;
  onChange: (change: PartChange) => void;
  /** Items only this kind has, before the moves. */
  extra?: (pick: (change: PartChange) => void) => ReactNode;
}

/** The menu of a column or a lane: rename, move, delete (and what `extra` adds). */
export function PartMenu({ label, first, last, axis, deleteLabel, deleteHint, onChange, extra }: Props) {
  const t = useT();
  const [Back, Forward] = axis === "x" ? [ArrowLeft, ArrowRight] : [ArrowUp, ArrowDown];
  return (
    <Menu label={label} button={<MoreHorizontal className="h-4 w-4" />}>
      {(close) => {
        const pick = (change: PartChange) => {
          close();
          onChange(change);
        };
        return (
          <>
            <button type="button" role="menuitem" className={menuItem} onClick={() => pick({ rename: true })}>
              <Pencil className="h-4 w-4 text-muted" /> {t("Rename")}
            </button>
            {extra?.(pick)}
            <button type="button" role="menuitem" className={menuItem} disabled={first} onClick={() => pick({ shift: -1 })}>
              <Back className="h-4 w-4 text-muted" /> {axis === "x" ? t("Move left") : t("Move up")}
            </button>
            <button type="button" role="menuitem" className={menuItem} disabled={last} onClick={() => pick({ shift: 1 })}>
              <Forward className="h-4 w-4 text-muted" /> {axis === "x" ? t("Move right") : t("Move down")}
            </button>
            <div className="flex items-center gap-2 px-1 py-1 text-sm text-muted">
              <DeleteButton label={deleteLabel} onConfirm={() => pick({ remove: true })} />
              {deleteHint}
            </div>
          </>
        );
      }}
    </Menu>
  );
}

/** A column's menu: also makes it the "done" kind. */
export function ColumnMenu({ column, first, last, onChange }: { column: Column; first: boolean; last: boolean; onChange: (change: PartChange) => void }) {
  const t = useT();
  return (
    <PartMenu
      label={t("Column options: {column}", { column: column.name })}
      first={first}
      last={last}
      axis="x"
      deleteLabel={t("Delete column")}
      deleteHint={t("Delete (when empty)")}
      onChange={onChange}
      extra={(pick) => (
        <button type="button" role="menuitemcheckbox" aria-checked={column.done} className={menuItem} onClick={() => pick({ done: !column.done })}>
          <CheckCircle2 className={`h-4 w-4 ${column.done ? "text-[var(--ok)]" : "text-muted"}`} /> {column.done ? t("Tasks here are finished") : t("Count tasks here as finished")}
        </button>
      )}
    />
  );
}
