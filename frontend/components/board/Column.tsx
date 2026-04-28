import TaskCard from "./TaskCard"

type Task = {
  id: string
  title: string
}

type ColumnProps = {
  title: string
  tasks: Task[]
}

export default function Column({ title, tasks }: ColumnProps) {
  return (
    <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-3 sm:p-4 min-h-[200px] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm sm:text-base font-semibold capitalize">
          {title}
        </h3>

        <span className="text-xs text-neutral-400">
          {tasks.length}
        </span>
      </div>

      <div className="flex flex-col gap-2 flex-1">
        {tasks.length === 0 ? (
          <div className="text-xs text-neutral-500 border border-dashed border-neutral-700 rounded-lg p-3 text-center">
            Drop tasks here
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))
        )}
      </div>
    </div>
  )
}