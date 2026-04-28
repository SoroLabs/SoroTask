"use client";

import { useState } from "react";
import DateInput from "./components/DateInput";

export default function Home() {
  const [taskData, setTaskData] = useState({
    contractAddress: '',
    functionName: '',
    interval: '',
    gasBalance: '',
    dueDate: '',
    parsedDueDate: undefined as Date | undefined
  });

  const handleDateChange = (value: string, parsedDate?: Date) => {
    setTaskData(prev => ({
      ...prev,
      dueDate: value,
      parsedDueDate: parsedDate
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Task submitted:', taskData);
    // Handle task submission logic here
  };

  const onReset = () => {
    if (confirmDiscard()) setForm(EMPTY_FORM);
  };

  return (
    /* Backdrop – clicking outside closes the dialog */
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Dialog container with role="dialog" and focus trap */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-dialog-title"
        aria-describedby="edit-dialog-desc"
        onKeyDown={handleKeyDown}
        className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-md shadow-2xl space-y-4"
      >
        <h2 id="edit-dialog-title" className="text-lg font-bold text-neutral-100">
          Edit Task #{task.id}
        </h2>
        <p id="edit-dialog-desc" className="sr-only">
          Update the details of automation task {task.id}. Press Escape to cancel.
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label
              htmlFor="edit-contract"
              className="block text-sm font-medium text-neutral-400 mb-1"
            >
              Target Contract Address
            </label>
            <input
              id="edit-contract"
              type="text"
              value={form.contractAddress}
              onChange={(e) => setForm({ ...form, contractAddress: e.target.value })}
              required
              autoComplete="off"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm text-neutral-100"
            />
          </div>

      <main className="container mx-auto px-6 py-12">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div>
            <h2 className="text-3xl font-bold">Your Keeper Dashboard</h2>
            <p className="text-neutral-400">Create, manage, and reorder recurring tasks with instant feedback.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={syncTasks}
              className="rounded-lg border border-neutral-700/80 bg-neutral-800/80 px-4 py-2 text-sm text-neutral-200 transition hover:border-neutral-500"
            >
              {isLoading ? 'Refreshing…' : 'Refresh tasks'}
            </button>
            <div className="text-sm text-neutral-400">{activeTaskCount} active tasks</div>
          </div>
        </div>

        {globalError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-6">
            {globalError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-12 xl:grid-cols-[1.1fr_1fr]">
          <section className="space-y-6">
            <h2 className="text-2xl font-bold">Create Automation Task</h2>
            <form onSubmit={handleSubmit} className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 space-y-4 shadow-xl">
              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Target Contract Address</label>
                <input 
                  type="text" 
                  placeholder="C..." 
                  value={taskData.contractAddress}
                  onChange={(e) => setTaskData(prev => ({ ...prev, contractAddress: e.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm" 
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-400 mb-1">Function Name</label>
                <input 
                  type="text" 
                  placeholder="harvest_yield" 
                  value={taskData.functionName}
                  onChange={(e) => setTaskData(prev => ({ ...prev, functionName: e.target.value }))}
                  className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm" 
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Interval (seconds)</label>
                  <input 
                    type="number" 
                    placeholder="3600" 
                    value={taskData.interval}
                    onChange={(e) => setTaskData(prev => ({ ...prev, interval: e.target.value }))}
                    className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm" 
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Gas Balance (XLM)</label>
                  <input 
                    type="number" 
                    placeholder="10" 
                    value={taskData.gasBalance}
                    onChange={(e) => setTaskData(prev => ({ ...prev, gasBalance: e.target.value }))}
                    className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm" 
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Interval (seconds)</label>
                    <input type="number" placeholder="3600" className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm touch-manipulation" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Gas Balance (XLM)</label>
                    <input type="number" placeholder="10" className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm touch-manipulation" />
                  </div>
                </div>
                <button className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors mt-2 shadow-lg shadow-blue-600/20 touch-manipulation">
                  Register Task
                </button>
              </div>
              
              {/* Natural Language Due Date Input */}
              <DateInput
                value={taskData.dueDate}
                onChange={handleDateChange}
                label="Due Date"
                required={false}
                className="mt-4"
              />
              
              <button 
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors mt-2 shadow-lg shadow-blue-600/20"
              >
                Register Task
              </button>
            </form>
          </section>

          <section className="space-y-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-2xl font-bold">Your Tasks</h3>
              <span className="rounded-full border border-neutral-700/70 bg-neutral-950/60 px-3 py-1 text-xs text-neutral-300">
                {tasks.length} total
              </span>
            </div>
            <div className="overflow-hidden rounded-3xl border border-neutral-700/50 bg-neutral-900/80 shadow-xl">
              <table className="min-w-full text-left text-sm text-neutral-200">
                <thead className="border-b border-neutral-800 bg-neutral-950/90 text-neutral-300">
                  <tr>
                    <th className="px-5 py-4">Task</th>
                    <th className="px-5 py-4">Interval</th>
                    <th className="px-5 py-4">Balance</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800 bg-neutral-900">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-neutral-400">
                        Loading tasks…
                      </td>
                    </tr>
                  ) : tasks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-neutral-500">
                        No tasks registered yet.
                      </td>
                    </tr>
                  ) : (
                    tasks.map((task, index) => {
                      const status = taskStatus[task.id]
                      const isPending = status?.pending ?? false
                      const errorText = status?.error
                      const isEditing = editingTaskId === task.id

                      return (
                        <tr
                          key={task.id}
                          className={isPending ? 'bg-blue-500/10' : 'hover:bg-neutral-800/50 transition-colors'}
                        >
                          <td className="px-5 py-4">
                            <div className="font-medium text-white">{task.func}</div>
                            <div className="mt-1 text-xs text-neutral-400 font-mono">{task.target}</div>
                          </td>
                          <td className="px-5 py-4">
                            {isEditing ? (
                              <input
                                value={editDraft.interval}
                                onChange={(event) => setEditDraft((current) => ({ ...current, interval: event.target.value }))}
                                type="number"
                                className="w-full rounded-lg border border-neutral-700/70 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                              />
                            ) : (
                              <span className="font-mono text-neutral-300">{task.interval}s</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            {isEditing ? (
                              <input
                                value={editDraft.balance}
                                onChange={(event) => setEditDraft((current) => ({ ...current, balance: event.target.value }))}
                                type="number"
                                className="w-full rounded-lg border border-neutral-700/70 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                              />
                            ) : (
                              <span className="font-mono text-neutral-300">{task.balance} XLM</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                                isPending
                                  ? 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-500/25'
                                  : 'bg-green-500/10 text-green-300 ring-1 ring-green-500/25'
                              }`}
                            >
                              {isPending ? 'Pending' : 'Active'}
                            </span>
                            {errorText ? (
                              <div className="mt-2 text-xs text-red-300">{errorText}</div>
                            ) : null}
                          </td>
                          <td className="px-5 py-4 space-y-2">
                            {isEditing ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => applyEdit(task)}
                                  disabled={isPending}
                                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-60"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingTaskId(null)}
                                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition hover:border-neutral-500"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => buildDraft(task)}
                                  disabled={isPending}
                                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition hover:border-neutral-500"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTask(task.id)}
                                  disabled={isPending}
                                  className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-200 transition hover:bg-red-500/20 disabled:opacity-60"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveTask(task.id, -1)}
                                  disabled={isPending || index === 0}
                                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition hover:border-neutral-500 disabled:opacity-40"
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveTask(task.id, 1)}
                                  disabled={isPending || index === tasks.length - 1}
                                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 transition hover:border-neutral-500 disabled:opacity-40"
                                >
                                  Down
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="mt-16 space-y-6">
          <h3 className="text-2xl font-bold">Execution Logs</h3>
          <div className="overflow-hidden rounded-xl border border-neutral-700/50 shadow-xl">
            <table className="w-full text-left text-sm text-neutral-400">
              <thead className="bg-neutral-800 text-neutral-200">
                <tr>
                  <th className="px-6 py-4">Task ID</th>
                  <th className="px-6 py-4">Target</th>
                  <th className="px-6 py-4">Keeper</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Timestamp</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-neutral-800 bg-neutral-900/50">
                <tr className="hover:bg-neutral-800/50 transition-colors">
                  <td className="px-6 py-4 font-mono text-neutral-300">
                    #1024
                  </td>
                  <td className="px-6 py-4 font-mono">CC...A12B</td>
                  <td className="px-6 py-4 font-mono">GA...99X</td>
                  <td className="px-6 py-4">
                    <TransactionStatus status="success" compact />
                  </td>
                  <td className="px-6 py-4">
                    <a href={`${STELLAR_EXPERT_BASE}/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-blue-400 hover:text-blue-300 underline transition-colors">
                      a1b2c3d4…a1b2
                    </a>
                  </td>
                  <td className="px-6 py-4">2 mins ago</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-yellow-500 transition-colors border border-neutral-700" title="Pause">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </button>
                      <button className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-red-500 transition-colors border border-neutral-700" title="Delete">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div ref={logsEndRef} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="edit-interval"
                className="block text-sm font-medium text-neutral-400 mb-1"
              >
                Interval (seconds)
              </label>
              <input
                id="edit-interval"
                type="number"
                min={1}
                value={form.interval}
                onChange={(e) => setForm({ ...form, interval: Number(e.target.value) })}
                required
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm text-neutral-100"
              />
            </div>
            <div>
              <label
                htmlFor="edit-gas"
                className="block text-sm font-medium text-neutral-400 mb-1"
              >
                Gas Balance (XLM)
              </label>
              <input
                id="edit-gas"
                type="number"
                min={0}
                value={form.gasBalance}
                onChange={(e) => setForm({ ...form, gasBalance: Number(e.target.value) })}
                required
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm text-neutral-100"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 rounded-lg transition-colors"
            >
              Save Changes
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-neutral-700 hover:bg-neutral-600 text-neutral-100 font-medium py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Task Card (Your Tasks) ─────────────────────────────────────────── */
interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

function TaskCard({ task, onEdit, onToggle, onDelete }: TaskCardProps) {
  const isPaused = task.status === "paused";

  return (
    <article
      aria-label={`Automation task ${task.id}: ${task.functionName} on ${task.contractAddress}`}
      className="bg-neutral-800 border border-neutral-700 rounded-xl p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="font-mono text-sm text-neutral-300 font-medium">
            #{task.id}
          </p>
          <p className="font-mono text-xs text-neutral-500 truncate max-w-[14rem]">
            {task.contractAddress}
          </p>
          <p className="text-sm text-neutral-200">
            <span className="sr-only">Function: </span>
            {task.functionName}
          </p>
        </div>

        {/* Status badge */}
        <span
          role="status"
          aria-label={`Task status: ${task.status}`}
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
            isPaused
              ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
              : "bg-green-500/10 text-green-400 border-green-500/20"
          }`}
        >
          {isPaused ? "Paused" : "Active"}
        </span>
      </div>

      <dl className="flex gap-4 text-xs text-neutral-500">
        <div>
          <dt className="sr-only">Interval</dt>
          <dd>Every {task.interval}s</dd>
        </div>
        <div>
          <dt className="sr-only">Gas balance</dt>
          <dd>{task.gasBalance} XLM</dd>
        </div>
      </dl>

      {/* Action buttons – all keyboard-accessible */}
      <div role="group" aria-label={`Actions for task ${task.id}`} className="flex gap-2 pt-1">
        <button
          id={`task-edit-${task.id}`}
          onClick={() => onEdit(task)}
          aria-label={`Edit task ${task.id}`}
          className="flex-1 text-xs bg-neutral-700 hover:bg-neutral-600 text-neutral-200 px-3 py-1.5 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Edit
        </button>
        <button
          id={`task-toggle-${task.id}`}
          onClick={() => onToggle(task.id)}
          aria-label={isPaused ? `Resume task ${task.id}` : `Pause task ${task.id}`}
          aria-pressed={isPaused}
          className="flex-1 text-xs bg-neutral-700 hover:bg-neutral-600 text-neutral-200 px-3 py-1.5 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {isPaused ? "Resume" : "Pause"}
        </button>
        <button
          id={`task-delete-${task.id}`}
          onClick={() => onDelete(task.id)}
          aria-label={`Delete task ${task.id}`}
          className="flex-1 text-xs bg-red-900/40 hover:bg-red-700/50 text-red-400 px-3 py-1.5 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Delete
        </button>
      </div>
    </article>
  );
}

/* ─── Live Region for announcements ─────────────────────────────────── */
function LiveRegion({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────── */
export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs] = useState<LogEntry[]>(MOCK_LOGS);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /* ── Create-task form state ── */
  const [contractAddress, setContractAddress] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [interval, setIntervalVal] = useState("");
  const [gasBalance, setGasBalance] = useState("");
  const [formError, setFormError] = useState("");

  const nextId = useRef(1);

  /* Helper to announce screen-reader messages */
  const announce = useCallback((msg: string) => {
    setAnnouncement("");
    // Defer to guarantee the aria-live region fires even for identical strings
    requestAnimationFrame(() => setAnnouncement(msg));
  }, []);

  /* ── Register task ── */
  const handleRegister = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setFormError("");

      if (!contractAddress.trim() || !functionName.trim()) {
        setFormError("Contract address and function name are required.");
        return;
      }
      if (Number(interval) < 1) {
        setFormError("Interval must be at least 1 second.");
        return;
      }
      if (Number(gasBalance) < 0) {
        setFormError("Gas balance cannot be negative.");
        return;
      }

      const newTask: Task = {
        id: nextId.current++,
        contractAddress: contractAddress.trim(),
        functionName: functionName.trim(),
        interval: Number(interval) || 3600,
        gasBalance: Number(gasBalance) || 10,
        status: "active",
      };

      setTasks((prev) => [newTask, ...prev]);
      setContractAddress("");
      setFunctionName("");
      setIntervalVal("");
      setGasBalance("");
      announce(`Task ${newTask.id} registered for ${newTask.functionName}.`);
    },
    [contractAddress, functionName, interval, gasBalance, announce]
  );

  /* ── Edit task ── */
  const handleSaveEdit = useCallback(
    (updated: Task) => {
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditingTask(null);
      announce(`Task ${updated.id} updated.`);
    },
    [announce]
  );

  /* ── Toggle task status ── */
  const handleToggle = useCallback(
    (id: number) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, status: t.status === "active" ? "paused" : "active" } : t
        )
      );
      const task = tasks.find((t) => t.id === id);
      if (task) {
        const next = task.status === "active" ? "paused" : "resumed";
        announce(`Task ${id} ${next}.`);
      }
    },
    [tasks, announce]
  );

  /* ── Delete task ── */
  const handleDelete = useCallback(
    (id: number) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      announce(`Task ${id} deleted.`);
    },
    [announce]
  );

  return (
    <>
      {/* ── Skip-to-content link (first focusable element on page) ── */}
      <a href="#main-content" className="skip-nav">
        Skip to main content
      </a>

      {/* ── Screen-reader live region ── */}
      <LiveRegion message={announcement} />

      {/* ── Edit-task dialog (focus-trapped, Escape closes) ── */}
      {editingTask && (
        <EditTaskDialog
          task={editingTask}
          onSave={handleSaveEdit}
          onClose={() => setEditingTask(null)}
        />
      )}

      <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans">
        {/* ── Header ── */}
        <header className="border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-10">
          <div className="container mx-auto px-6 py-4 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div
                aria-hidden="true"
                className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20"
              >
                S
              </div>
              {/* Single h1 per page for correct heading hierarchy */}
              <h1 className="text-xl font-bold tracking-tight">SoroTask</h1>
            </div>

            <button
              id="connect-wallet-btn"
              aria-label="Connect your Stellar wallet"
              className="bg-neutral-100 text-neutral-900 px-4 py-2 rounded-md font-medium hover:bg-neutral-200 transition-colors"
            >
              Connect Wallet
            </button>
          </div>
        </header>

        {/* ── Main content ── */}
        <main id="main-content" tabIndex={-1} className="container mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">

            {/* ── Create Task Section ── */}
            <section aria-labelledby="create-task-heading">
              <h2 id="create-task-heading" className="text-2xl font-bold mb-6">
                Create Automation Task
              </h2>

              <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 shadow-xl">
                <form
                  id="create-task-form"
                  onSubmit={handleRegister}
                  noValidate
                  aria-label="Register a new automation task"
                >
                  {/* Inline form error – visually and announced to screen readers */}
                  {formError && (
                    <div
                      role="alert"
                      aria-live="assertive"
                      id="form-error"
                      className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2"
                    >
                      {formError}
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor="contract-address"
                        className="block text-sm font-medium text-neutral-400 mb-1"
                      >
                        Target Contract Address{" "}
                        <span aria-hidden="true" className="text-red-400">*</span>
                      </label>
                      <input
                        id="contract-address"
                        type="text"
                        placeholder="C..."
                        value={contractAddress}
                        onChange={(e) => setContractAddress(e.target.value)}
                        required
                        aria-required="true"
                        aria-describedby={formError ? "form-error" : undefined}
                        autoComplete="off"
                        className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="function-name"
                        className="block text-sm font-medium text-neutral-400 mb-1"
                      >
                        Function Name{" "}
                        <span aria-hidden="true" className="text-red-400">*</span>
                      </label>
                      <input
                        id="function-name"
                        type="text"
                        placeholder="harvest_yield"
                        value={functionName}
                        onChange={(e) => setFunctionName(e.target.value)}
                        required
                        aria-required="true"
                        autoComplete="off"
                        className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor="interval-seconds"
                          className="block text-sm font-medium text-neutral-400 mb-1"
                        >
                          Interval (seconds)
                        </label>
                        <input
                          id="interval-seconds"
                          type="number"
                          placeholder="3600"
                          min={1}
                          value={interval}
                          onChange={(e) => setIntervalVal(e.target.value)}
                          className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="gas-balance"
                          className="block text-sm font-medium text-neutral-400 mb-1"
                        >
                          Gas Balance (XLM)
                        </label>
                        <input
                          id="gas-balance"
                          type="number"
                          placeholder="10"
                          min={0}
                          value={gasBalance}
                          onChange={(e) => setGasBalance(e.target.value)}
                          className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                        />
                      </div>
                    </div>

                    <button
                      id="register-task-btn"
                      type="submit"
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 rounded-lg transition-colors mt-2 shadow-lg shadow-blue-600/20"
                    >
                      Register Task
                    </button>
                  </div>
                </form>
              </div>
            </section>

            {/* ── Your Tasks Section ── */}
            <section aria-labelledby="your-tasks-heading">
              <h2 id="your-tasks-heading" className="text-2xl font-bold mb-6">
                Your Tasks
                {tasks.length > 0 && (
                  <span className="ml-2 text-base font-normal text-neutral-500">
                    ({tasks.length})
                  </span>
                )}
              </h2>

              {tasks.length === 0 ? (
                <div
                  aria-live="polite"
                  className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-6 min-h-[300px] flex flex-col items-center justify-center text-neutral-500 shadow-xl"
                >
                  <p>No tasks registered yet.</p>
                  <p className="text-sm mt-1">Fill in the form to create your first automation task.</p>
                </div>
              ) : (
                <ul
                  aria-label="Registered automation tasks"
                  className="space-y-4"
                >
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <TaskCard
                        task={task}
                        onEdit={setEditingTask}
                        onToggle={handleToggle}
                        onDelete={handleDelete}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ── Execution Logs ── */}
          <section aria-labelledby="exec-logs-heading" className="mt-16">
            <h2 id="exec-logs-heading" className="text-2xl font-bold mb-6">
              Execution Logs
            </h2>
            <div className="overflow-x-auto overflow-hidden rounded-xl border border-neutral-700/50 shadow-xl">
              <table
                aria-label="Task execution logs"
                className="w-full text-left text-sm text-neutral-400"
              >
                <caption className="sr-only">
                  A log of recent task executions showing task ID, target contract, keeper, status
                  and timestamp.
                </caption>
                <thead className="bg-neutral-800/80 text-neutral-200 backdrop-blur-sm">
                  <tr>
                    <th scope="col" className="px-6 py-4 font-medium">Task ID</th>
                    <th scope="col" className="px-6 py-4 font-medium">Target</th>
                    <th scope="col" className="px-6 py-4 font-medium">Keeper</th>
                    <th scope="col" className="px-6 py-4 font-medium">Status</th>
                    <th scope="col" className="px-6 py-4 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800 bg-neutral-900/50">
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-neutral-800/50 transition-colors"
                    >
                      <td className="px-6 py-4 font-mono text-neutral-300">
                        #{log.taskId}
                      </td>
                      <td className="px-6 py-4 font-mono">{log.target}</td>
                      <td className="px-6 py-4 font-mono">{log.keeper}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                            log.status === "success"
                              ? "bg-green-500/10 text-green-400 border-green-500/20"
                              : log.status === "failed"
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                          }`}
                        >
                          {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <time>{log.timestamp}</time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}
