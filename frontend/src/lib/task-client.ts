export type Task = {
  id: string
  target: string
  func: string
  interval: number
  balance: number
  status: 'pending' | 'active' | 'completed' | 'cancelled'
}

export type TaskCreate = Omit<Task, 'id' | 'status'>

const initialTasks: Task[] = [
  {
    id: 'task-1001',
    target: 'C123...A789',
    func: 'harvest_yield',
    interval: 3600,
    balance: 12,
    status: 'active',
  },
  {
    id: 'task-1002',
    target: 'C456...B012',
    func: 'rebalance',
    interval: 7200,
    balance: 8,
    status: 'active',
  },
]

let persistedTasks: Task[] = [...initialTasks]

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const fetchTasks = async (): Promise<Task[]> => {
  await delay(250)
  return persistedTasks.map((task) => ({ ...task }))
}

export const createTask = async (task: TaskCreate): Promise<Task> => {
  await delay(300)
  const created: Task = {
    ...task,
    id: `task-${Date.now()}`,
    status: 'active',
  }
  persistedTasks = [created, ...persistedTasks]
  return { ...created }
}

export const updateTask = async (
  taskId: string,
  changes: Partial<TaskCreate>
): Promise<Task> => {
  await delay(250)
  let updatedTask: Task | undefined
  persistedTasks = persistedTasks.map((task) => {
    if (task.id !== taskId) return task
    updatedTask = { ...task, ...changes }
    return updatedTask
  })
  if (!updatedTask) {
    throw new Error('Task not found')
  }
  return { ...updatedTask }
}

export const deleteTask = async (taskId: string): Promise<string> => {
  await delay(200)
  persistedTasks = persistedTasks.filter((task) => task.id !== taskId)
  return taskId
}

export const moveTask = async (taskId: string, direction: -1 | 1): Promise<Task[]> => {
  await delay(200)
  const index = persistedTasks.findIndex((task) => task.id === taskId)
  if (index === -1) {
    throw new Error('Task not found')
  }
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= persistedTasks.length) {
    throw new Error('Unable to move task')
  }
  const next = [...persistedTasks]
  const [item] = next.splice(index, 1)
  next.splice(targetIndex, 0, item)
  persistedTasks = next
  return persistedTasks.map((task) => ({ ...task }))
}

export const resetTasks = (): void => {
  persistedTasks = [...initialTasks]
}
