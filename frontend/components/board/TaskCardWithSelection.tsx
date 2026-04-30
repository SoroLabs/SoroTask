"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTaskSelection } from "@/src/hooks/useTaskSelection";

type Task = {
  id: string;
  title: string;
};

export default function TaskCardWithSelection({ task }: { task: Task }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const { isTaskSelected, selectTask } = useTaskSelection();
  const isSelected = isTaskSelected(task.id);

  const handleClick = (e: React.MouseEvent) => {
    // Don't interfere with drag operations
    if (isDragging) return;
    
    // Prevent drag listeners from interfering
    e.stopPropagation();
    selectTask(task.id);
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      className={`w-full touch-none rounded-lg border p-3 text-left text-sm font-medium outline-none transition ${
        isDragging
          ? "border-blue-400 bg-blue-500/20 opacity-80"
          : isSelected
          ? "border-primary-500 bg-primary-500/10 ring-2 ring-primary-500/50"
          : "border-neutral-700 bg-neutral-900 hover:border-neutral-500"
      } focus-visible:ring-2 focus-visible:ring-blue-400`}
      aria-label={`${task.title}${isSelected ? " (selected)" : ""}`}
      aria-pressed={isSelected}
      data-task-id={task.id}
    >
      {task.title}
    </button>
  );
}

export type { Task };
