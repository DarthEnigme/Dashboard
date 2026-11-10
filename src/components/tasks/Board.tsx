"use client";

import { useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type UniqueIdentifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import type { Column, Task } from "@/lib/tasks/types";
import { useT } from "@/i18n/client";
import { inputClass } from "../edit/FieldInput";
import { ColumnMenu, type ColumnChange } from "./ColumnMenu";
import { TaskCard } from "./TaskCard";

interface Props {
  columns: Column[];
  /** False while a filter hides tasks: positions on screen are then not positions in the column. */
  canMove: boolean;
  onOpen: (task: Task) => void;
  onAdd: (column: number, title: string) => void;
  /** The task now sits at `index` of `column`; `columns` is the board as it should look meanwhile. */
  onMove: (task: number, column: number, index: number, columns: Column[]) => void;
  onColumn: (id: number, change: ColumnChange) => void;
}

const columnKey = (id: number) => `column-${id}`;
/** The column a drag is over: the one with that key, or the one holding that task. */
const columnOf = (columns: Column[], id: UniqueIdentifier) => columns.find((c) => columnKey(c.id) === id || c.tasks.some((t) => t.id === id));

/** The kanban board: tasks are dragged between and within columns (or moved with the keyboard). */
export function Board({ columns, canMove, onOpen, onAdd, onMove, onColumn }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // While a task is dragged, the board is drawn from this copy, which follows the pointer.
  const [drag, setDrag] = useState<{ task: Task; columns: Column[] }>();
  const shown = drag?.columns ?? columns;

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!drag || !over) return;
    const from = columnOf(drag.columns, active.id);
    const to = columnOf(drag.columns, over.id);
    if (!from || !to || from === to) return;
    // Into another column: before the task it is over, or last when over the column itself.
    const at = to.tasks.findIndex((t) => t.id === over.id);
    const moved = { ...drag.task, column_id: to.id };
    setDrag({
      task: drag.task,
      columns: drag.columns.map((c) => {
        if (c === from) return { ...c, tasks: c.tasks.filter((t) => t.id !== active.id) };
        if (c === to) return { ...c, tasks: at < 0 ? [...c.tasks, moved] : [...c.tasks.slice(0, at), moved, ...c.tasks.slice(at)] };
        return c;
      }),
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!drag) return;
    setDrag(undefined);
    const column = columnOf(drag.columns, active.id);
    if (!column) return;
    const from = column.tasks.findIndex((t) => t.id === active.id);
    const to = over ? column.tasks.findIndex((t) => t.id === over.id) : -1;
    const tasks = to >= 0 && to !== from ? arrayMove(column.tasks, from, to) : column.tasks;
    const index = tasks.findIndex((t) => t.id === active.id);
    const before = columns.find((c) => c.tasks.some((t) => t.id === active.id));
    if (before?.id === column.id && before.tasks.findIndex((t) => t.id === active.id) === index) return;
    onMove(drag.task.id, column.id, index, drag.columns.map((c) => (c === column ? { ...c, tasks } : c)));
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
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(undefined)}
    >
      <div className="flex items-start gap-3 overflow-x-auto pb-2">
        {shown.map((c, i) => (
          <BoardColumn key={c.id} column={c} canMove={canMove} first={i === 0} last={i === shown.length - 1} onOpen={onOpen} onAdd={onAdd} onChange={(change) => onColumn(c.id, change)} />
        ))}
      </div>
      <DragOverlay>{drag && <TaskCard task={drag.task} dragging />}</DragOverlay>
    </DndContext>
  );
}

interface ColumnProps {
  column: Column;
  canMove: boolean;
  first: boolean;
  last: boolean;
  onOpen: (task: Task) => void;
  onAdd: (column: number, title: string) => void;
  onChange: (change: ColumnChange) => void;
}

function BoardColumn({ column, canMove, first, last, onOpen, onAdd, onChange }: ColumnProps) {
  const t = useT();
  // The column itself takes drops, so a task can land in an empty one.
  const { setNodeRef, isOver } = useDroppable({ id: columnKey(column.id) });
  const [title, setTitle] = useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(column.id, title);
    setTitle("");
  };

  return (
    <section aria-label={column.name} className="glass flex w-72 shrink-0 flex-col gap-2 rounded-3xl p-3">
      <header className="flex items-center gap-2 px-1">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{column.name}</h2>
        <span className="text-xs text-muted tabular-nums">{column.tasks.length}</span>
        <ColumnMenu column={column} first={first} last={last} onChange={onChange} />
      </header>
      <SortableContext items={column.tasks.map((task) => task.id)} strategy={verticalListSortingStrategy} disabled={!canMove}>
        <ul ref={setNodeRef} className={`flex min-h-10 flex-col gap-2 rounded-2xl transition ${isOver ? "bg-hover" : ""}`}>
          {column.tasks.map((task) => (
            <SortableTask key={task.id} task={task} onOpen={() => onOpen(task)} />
          ))}
        </ul>
      </SortableContext>
      <form onSubmit={add} className="flex items-center gap-1">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t("Add a task…")} aria-label={t("Add a task to {column}", { column: column.name })} className={`${inputClass} h-9 text-sm`} />
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
