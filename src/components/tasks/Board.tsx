"use client";

import { Fragment, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors, type DragOverEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { Column, Lane, Task } from "@/lib/tasks/types";
import { useT } from "@/i18n/client";
import { inputClass } from "../edit/FieldInput";
import { cellKey, cellOf, dropResult, inCell, moveToCell, rowsOf, type Cell } from "./cells";
import { ColumnMenu, PartMenu, type PartChange } from "./PartMenu";
import { TaskCard } from "./TaskCard";

interface Props {
  columns: Column[];
  lanes: Lane[];
  /** False while a filter hides tasks: positions on screen are then not positions in the column. */
  canMove: boolean;
  onOpen: (task: Task) => void;
  onAdd: (cell: Cell, title: string) => void;
  /** The task now sits at `index` of `cell`; `columns` is the board as it should look meanwhile. */
  onMove: (task: number, cell: Cell, index: number, columns: Column[]) => void;
  onColumn: (id: number, change: PartChange) => void;
  onLane: (id: number, change: PartChange | { collapsed: boolean }) => void;
}

/**
 * The kanban board: a grid of columns and lanes (a board without lanes is one row). Tasks are dragged
 * between and within cells, or moved with the keyboard.
 */
export function Board({ columns, lanes, canMove, onOpen, onAdd, onMove, onColumn, onLane }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // While a task is dragged, the board is drawn from this copy, which follows the pointer.
  const [drag, setDrag] = useState<{ task: Task; columns: Column[] }>();
  const shown = drag?.columns ?? columns;
  // The grid's rows: the column titles, then for each lane its title (when the board has lanes) and its cells (unless folded).
  let next = 2;
  const placed = rowsOf({ lanes }).map((lane) => ({ lane, title: lanes.length ? next++ : undefined, cells: lane?.collapsed ? undefined : next++ }));
  const height = next - 1;

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!drag || !over) return;
    const from = cellOf(drag.columns, active.id);
    const to = cellOf(drag.columns, over.id);
    if (!from || !to || (from.column === to.column && from.lane === to.lane)) return;
    setDrag({ task: drag.task, columns: moveToCell(drag.columns, drag.task, to, over.id) });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={({ active }) => {
        const task = columns.flatMap((c) => c.tasks).find((t) => t.id === active.id);
        if (task) setDrag({ task, columns });
      }}
      onDragOver={onDragOver}
      onDragEnd={({ active, over }) => {
        if (!drag) return;
        setDrag(undefined);
        const drop = dropResult(columns, drag.columns, active.id, over?.id);
        if (drop) onMove(drag.task.id, drop.cell, drop.index, drop.columns);
      }}
      onDragCancel={() => setDrag(undefined)}
    >
      <div className="overflow-x-auto pb-2">
        <div className="grid w-max gap-x-3" style={{ gridTemplateColumns: `repeat(${shown.length}, 18rem)` }}>
          {/* One box per column, behind its title and all of its cells. */}
          {shown.map((c, i) => (
            <div key={`box-${c.id}`} aria-hidden className="glass rounded-3xl" style={{ gridColumn: i + 1, gridRow: `1 / span ${height}` }} />
          ))}
          {shown.map((c, i) => (
            <header key={c.id} className="relative flex items-center gap-2 px-4 pt-3 pb-2" style={{ gridColumn: i + 1, gridRow: 1 }}>
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</h2>
              <span className="text-xs text-muted tabular-nums">{c.tasks.length}</span>
              <ColumnMenu column={c} first={i === 0} last={i === shown.length - 1} onChange={(change) => onColumn(c.id, change)} />
            </header>
          ))}
          {placed.map(({ lane, title, cells }, r) => (
            <Fragment key={lane?.id ?? "none"}>
              {title !== undefined && <LaneHeader lane={lane} row={title} index={r} count={lanes.length} columns={shown} onChange={(change) => lane && onLane(lane.id, change)} />}
              {cells !== undefined &&
                shown.map((c, i) => (
                  <BoardCell key={c.id} column={c} lane={lane} canMove={canMove} place={{ gridColumn: i + 1, gridRow: cells }} onOpen={onOpen} onAdd={(title) => onAdd({ column: c.id, lane: lane?.id ?? null }, title)} />
                ))}
            </Fragment>
          ))}
        </div>
      </div>
      <DragOverlay>{drag && <TaskCard task={drag.task} dragging />}</DragOverlay>
    </DndContext>
  );
}

/** A lane's title, across the whole board: fold, name, count, menu. */
function LaneHeader({ lane, row, index, count, columns, onChange }: { lane: Lane | null; row: number; index: number; count: number; columns: Column[]; onChange: (change: PartChange | { collapsed: boolean }) => void }) {
  const t = useT();
  const tasks = columns.reduce((n, c) => n + inCell(c, lane?.id ?? null).length, 0);
  const Fold = lane?.collapsed ? ChevronRight : ChevronDown;
  return (
    <div className="relative flex min-h-9 items-center gap-1.5 border-t border-line px-3 py-1.5" style={{ gridColumn: "1 / -1", gridRow: row }}>
      {lane ? (
        <>
          <button type="button" onClick={() => onChange({ collapsed: !lane.collapsed })} aria-expanded={!lane.collapsed} aria-label={lane.collapsed ? t("Show lane {lane}", { lane: lane.name }) : t("Fold lane {lane}", { lane: lane.name })} className="rounded p-0.5 text-muted hover:text-fg">
            <Fold className="h-4 w-4" />
          </button>
          <span className="truncate text-xs font-semibold tracking-wide uppercase">{lane.name}</span>
          <span className="text-xs text-muted tabular-nums">{tasks}</span>
          <PartMenu label={t("Lane options: {lane}", { lane: lane.name })} first={index === 0} last={index === count - 1} axis="y" deleteLabel={t("Delete lane")} deleteHint={t("Delete (its tasks stay, with no lane)")} onChange={onChange} />
        </>
      ) : (
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{t("No lane")}</span>
      )}
    </div>
  );
}

interface CellProps {
  column: Column;
  lane: Lane | null;
  canMove: boolean;
  /** Its place in the board's grid. */
  place: React.CSSProperties;
  onOpen: (task: Task) => void;
  onAdd: (title: string) => void;
}

function BoardCell({ column, lane, canMove, place, onOpen, onAdd }: CellProps) {
  const t = useT();
  const tasks = inCell(column, lane?.id ?? null);
  // The cell itself takes drops, so a task can land in an empty one.
  const { setNodeRef, isOver } = useDroppable({ id: cellKey({ column: column.id, lane: lane?.id ?? null }) });
  const [title, setTitle] = useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(title);
    setTitle("");
  };
  const where = lane ? `${column.name} · ${lane.name}` : column.name;

  return (
    <section aria-label={where} className="relative flex flex-col gap-2 px-3 pt-1 pb-3" style={place}>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy} disabled={!canMove}>
        <ul ref={setNodeRef} className={`flex min-h-10 flex-col gap-2 rounded-2xl transition ${isOver ? "bg-hover" : ""}`}>
          {tasks.map((task) => (
            <SortableTask key={task.id} task={task} onOpen={() => onOpen(task)} />
          ))}
        </ul>
      </SortableContext>
      <form onSubmit={add} className="flex items-center gap-1">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("Add a task…")} aria-label={t("Add a task to {column}", { column: where })} className={`${inputClass} h-9 text-sm`} />
        <button type="submit" disabled={!title.trim()} aria-label={t("Add")} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-hover hover:text-fg disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}

function SortableTask({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    // The whole card is the handle; a click that didn't drag opens the task.
    <li ref={setNodeRef} {...attributes} {...listeners} role="listitem" style={{ transform: CSS.Translate.toString(transform), transition }} className={`touch-none ${isDragging ? "opacity-30" : ""}`}>
      <TaskCard task={task} onOpen={onOpen} />
    </li>
  );
}
