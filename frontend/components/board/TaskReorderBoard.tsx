"use client";

/**
 * #878 — Drag-and-Drop Task Reordering Board
 *
 * A focused single-column reorder board powered by @dnd-kit/sortable.
 * Keyboard accessibility:
 *   - Tab / Shift-Tab to focus items
 *   - Space / Enter    to pick up an item (announces "grabbed, position N of M")
 *   - ArrowUp / ArrowDown to move the grabbed item
 *   - Space / Enter    to drop at the current position
 *   - Escape           to cancel and return to the original position
 *
 * Uses live-region announcements so screen readers convey position changes
 * without relying on visual focus rings alone.
 */

import { useCallback, useId, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReorderTask {
  id: string;
  title: string;
  status?: string;
  priority?: "low" | "medium" | "high";
}

interface TaskReorderBoardProps {
  initialTasks?: ReorderTask[];
  onOrderChange?: (orderedTasks: ReorderTask[]) => void;
}

// ---------------------------------------------------------------------------
// Announcement messages (a11y)
// ---------------------------------------------------------------------------

function buildAnnouncements(tasks: ReorderTask[]) {
  return {
    onDragStart({ active }: { active: { id: string | number } }) {
      const idx = tasks.findIndex((t) => t.id === active.id);
      const task = tasks[idx];
      return task
        ? `Grabbed "${task.title}", position ${idx + 1} of ${tasks.length}.`
        : undefined;
    },
    onDragOver({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
      if (!over) return undefined;
      const overIdx = tasks.findIndex((t) => t.id === over.id);
      return `Moving to position ${overIdx + 1} of ${tasks.length}.`;
    },
    onDragEnd({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
      if (!over || active.id === over.id) return `Cancelled — item returned to original position.`;
      const overIdx = tasks.findIndex((t) => t.id === over.id);
      const task = tasks.find((t) => t.id === active.id);
      return task
        ? `Dropped "${task.title}" at position ${overIdx + 1} of ${tasks.length}.`
        : undefined;
    },
    onDragCancel() {
      return "Drag cancelled — item returned to original position.";
    },
  };
}

// ---------------------------------------------------------------------------
// Default data
// ---------------------------------------------------------------------------

const DEFAULT_TASKS: ReorderTask[] = [
  { id: "rt-1", title: "Implement wallet connect", status: "Todo", priority: "high" },
  { id: "rt-2", title: "Add rate limiter to GraphQL", status: "In Progress", priority: "high" },
  { id: "rt-3", title: "Write keeper integration tests", status: "Todo", priority: "medium" },
  { id: "rt-4", title: "Update OpenAPI spec", status: "Done", priority: "low" },
  { id: "rt-5", title: "Fix staleTasks reconciler edge case", status: "Todo", priority: "medium" },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TaskReorderBoard({
  initialTasks = DEFAULT_TASKS,
  onOrderChange,
}: TaskReorderBoardProps) {
  const [tasks, setTasks] = useState<ReorderTask[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const announceRef = useRef<HTMLDivElement>(null);
  const liveId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const announce = useCallback((msg: string | undefined) => {
    if (!msg || !announceRef.current) return;
    announceRef.current.textContent = msg;
  }, []);

  const handleDragStart = useCallback(
    ({ active }: DragStartEvent) => {
      setActiveId(String(active.id));
      const idx = tasks.findIndex((t) => t.id === active.id);
      const task = tasks[idx];
      if (task) announce(`Grabbed "${task.title}", position ${idx + 1} of ${tasks.length}.`);
    },
    [tasks, announce]
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveId(null);
      if (!over || active.id === over.id) {
        announce("Drag cancelled — item returned to original position.");
        return;
      }
      const oldIndex = tasks.findIndex((t) => t.id === active.id);
      const newIndex = tasks.findIndex((t) => t.id === over.id);
      const reordered = arrayMove(tasks, oldIndex, newIndex);
      setTasks(reordered);
      onOrderChange?.(reordered);
      const task = tasks[oldIndex];
      if (task) announce(`Dropped "${task.title}" at position ${newIndex + 1} of ${tasks.length}.`);
    },
    [tasks, onOrderChange, announce]
  );

  const activeTask = tasks.find((t) => t.id === activeId);

  return (
    <section aria-label="Task reorder board" className="space-y-4">
      {/* Live region for screen reader announcements */}
      <div
        ref={announceRef}
        id={liveId}
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />

      <header>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Task Order
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Drag tasks to reorder, or focus an item and press{" "}
          <kbd className="rounded border border-gray-300 dark:border-gray-600 px-1 font-mono text-xs">Space</kbd>{" "}
          then{" "}
          <kbd className="rounded border border-gray-300 dark:border-gray-600 px-1 font-mono text-xs">↑</kbd>{" "}
          <kbd className="rounded border border-gray-300 dark:border-gray-600 px-1 font-mono text-xs">↓</kbd>{" "}
          to move it with the keyboard.
        </p>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          announce("Drag cancelled — item returned to original position.");
        }}
        accessibility={{ announcements: buildAnnouncements(tasks) }}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ol
            aria-label="Reorderable task list"
            className="space-y-2"
            aria-describedby={liveId}
          >
            {tasks.map((task, index) => (
              <SortableTaskRow
                key={task.id}
                task={task}
                index={index}
                total={tasks.length}
                isGrabbed={task.id === activeId}
              />
            ))}
          </ol>
        </SortableContext>

        <DragOverlay>
          {activeTask && (
            <div className="rounded-xl border-2 border-indigo-500 bg-white dark:bg-gray-800 px-4 py-3 shadow-2xl opacity-90">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {activeTask.title}
              </span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {tasks.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-8">No tasks to reorder.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// SortableTaskRow
// ---------------------------------------------------------------------------

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
};

function SortableTaskRow({
  task,
  index,
  total,
  isGrabbed,
}: {
  task: ReorderTask;
  index: number;
  total: number;
  isGrabbed: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      aria-label={`${task.title}, position ${index + 1} of ${total}`}
      aria-grabbed={isGrabbed}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 bg-white dark:bg-gray-800 select-none transition-shadow ${
        isDragging
          ? "opacity-40 shadow-none border-dashed border-indigo-400"
          : "border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md"
      }`}
    >
      {/* Drag handle */}
      <button
        {...listeners}
        {...attributes}
        aria-label={`Drag handle for "${task.title}"`}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded p-1"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <circle cx="5" cy="4" r="1.5" />
          <circle cx="11" cy="4" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="11" cy="12" r="1.5" />
        </svg>
      </button>

      {/* Position badge */}
      <span
        aria-hidden="true"
        className="flex-none w-6 text-center text-xs font-mono text-gray-400"
      >
        {index + 1}
      </span>

      {/* Title */}
      <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
        {task.title}
      </span>

      {/* Status */}
      {task.status && (
        <span className="flex-none text-xs text-gray-500 dark:text-gray-400">
          {task.status}
        </span>
      )}

      {/* Priority badge */}
      {task.priority && (
        <span
          className={`flex-none rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[task.priority] ?? ""}`}
        >
          {task.priority}
        </span>
      )}
    </li>
  );
}
