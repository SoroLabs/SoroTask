"use client"

import { useMemo, useRef, useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import TaskCardWithSelection from "./TaskCardWithSelection"
import { useCollaborativePresence } from "../../hooks/useCollaborativePresence"
import CollaborativePresenceLayer from "./CollaborativePresenceLayer"

// WebSocket presence server URL — override via env in production
const PRESENCE_WS_URL =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PRESENCE_WS_URL
    ? process.env.NEXT_PUBLIC_PRESENCE_WS_URL
    : 'ws://localhost:4001/presence'

type Task = {
  id: string
  title: string
}

type Columns = Record<string, Task[]>

const columnLabels: Record<string, string> = {
  todo: "Todo",
  doing: "Doing",
  done: "Done",
}

export default function Board() {
  const boardRef = useRef<HTMLElement>(null)
  const { collaborators, connected } = useCollaborativePresence(PRESENCE_WS_URL, boardRef)

  const [columns, setColumns] = useState<Columns>({
    todo: [
      { id: "1", title: "Task 1" },
      { id: "2", title: "Task 2" },
    ],
    doing: [{ id: "3", title: "Task 3" }],
    done: [],
  })

  const columnIds = useMemo(() => Object.keys(columns), [columns])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const findColumn = (id: string) => {
    if (columns[id]) return id

    return Object.keys(columns).find((columnId) =>
      columns[columnId].some((task) => task.id === id)
    )
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return

    const activeColumn = findColumn(String(active.id))
    const overColumn = findColumn(String(over.id))

    if (!activeColumn || !overColumn) return

    if (activeColumn === overColumn) {
      const oldIndex = columns[activeColumn].findIndex(
        (task) => task.id === active.id
      )
      const newIndex = columns[overColumn].findIndex(
        (task) => task.id === over.id
      )

      if (oldIndex === newIndex || newIndex === -1) return

      setColumns((current) => ({
        ...current,
        [activeColumn]: arrayMove(current[activeColumn], oldIndex, newIndex),
      }))

      return
    }

    setColumns((current) => {
      const activeTask = current[activeColumn].find(
        (task) => task.id === active.id
      )

      if (!activeTask) return current

      return {
        ...current,
        [activeColumn]: current[activeColumn].filter(
          (task) => task.id !== active.id
        ),
        [overColumn]: [...current[overColumn], activeTask],
      }
    })
  }

  return (
    <section aria-label="Task board" ref={boardRef} style={{ position: 'relative' }}>
      {/* Presence status indicator */}
      <div className="mb-2 flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-neutral-500'}`}
          title={connected ? 'Live collaboration active' : 'Offline — reconnecting…'}
        />
        {collaborators.length > 0 && (
          <span className="text-xs text-neutral-400">
            {collaborators.length} collaborator{collaborators.length !== 1 ? 's' : ''} online
          </span>
        )}
      </div>

      <p className="mb-4 text-sm text-neutral-400">
        Drag tasks between columns. Keyboard users can focus a task, press Space,
        move with arrow keys, and press Space again to drop.
      </p>

      {/* Live cursors & avatars for remote collaborators */}
      <CollaborativePresenceLayer collaborators={collaborators} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {columnIds.map((columnId) => (
            <BoardColumn
              key={columnId}
              id={columnId}
              label={columnLabels[columnId] ?? columnId}
              tasks={columns[columnId]}
            />
          ))}
        </div>
      </DndContext>
    </section>
  )
}

function BoardColumn({
  id,
  label,
  tasks,
}: {
  id: string
  label: string
  tasks: Task[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`min-h-36 rounded-xl border p-4 transition-colors ${
        isOver
          ? "border-blue-400 bg-blue-500/10"
          : "border-neutral-700 bg-neutral-800/50"
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{label}</h3>
        <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400">
          {tasks.length}
        </span>
      </div>

      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3">
          {tasks.length > 0 ? (
            tasks.map((task) => <TaskCardWithSelection key={task.id} task={task} />)
          ) : (
            <div className="rounded-lg border border-dashed border-neutral-700 p-4 text-sm text-neutral-500">
              Drop task here
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}