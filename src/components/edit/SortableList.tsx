"use client";

import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useT } from "@/i18n/client";

type Keyed = { _key: string };

interface Props<T extends Keyed> {
  items: T[];
  onReorder: (items: T[]) => void;
  layout?: "grid" | "list";
  className?: string;
  children: (item: T, index: number, handle: ReactNode) => ReactNode;
}

export function SortableList<T extends Keyed>({ items, onReorder, layout = "list", className, children }: Props<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i._key === active.id);
    const to = items.findIndex((i) => i._key === over.id);
    if (from !== -1 && to !== -1) onReorder(arrayMove(items, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext
        items={items.map((i) => i._key)}
        strategy={layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy}
      >
        <div className={className}>
          {items.map((item, i) => (
            <SortableItem key={item._key} id={item._key}>
              {(handle) => children(item, i, handle)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const t = useT();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t("Drag to reorder")}
      className="cursor-grab touch-none rounded-lg p-1 text-muted hover:bg-hover hover:text-fg active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={isDragging ? "opacity-80" : undefined}
    >
      {children(handle)}
    </div>
  );
}
