type Task = {
  id: string
  title: string
}

type TaskCardProps = {
  task: Task
}

export default function TaskCard({ task }: TaskCardProps) {
  return (
    <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-3 sm:p-4 cursor-grab active:cursor-grabbing touch-none select-none transition hover:border-neutral-500">
      <p className="text-sm sm:text-base font-medium leading-tight">
        {task.title}
      </p>
    </div>
  )
}

export type { Task }