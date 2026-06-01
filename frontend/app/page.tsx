"use client";

import { useState, useCallback, useRef, FormEvent } from "react";
import DateInput from "./components/DateInput";
import ZKProofVerification from "./components/ZKProofVerification";

export interface Task {
  id: number;
  contractAddress: string;
  functionName: string;
  interval: number;
  gasBalance: number;
  status: "active" | "paused";
  zkVerified?: boolean;
  zkConditionHash?: string;
}

export interface LogEntry {
  id: string;
  taskId: number;
  target: string;
  keeper: string;
  status: "success" | "failed" | "pending";
  timestamp: string;
}

const MOCK_LOGS: LogEntry[] = [
  {
    id: "log-1",
    taskId: 1024,
    target: "CC...A12B",
    keeper: "GA...99X",
    status: "success",
    timestamp: "2 mins ago",
  },
];

interface EditTaskDialogProps {
  task: Task;
  onSave: (updated: Task) => void;
  onClose: () => void;
}

function EditTaskDialog({ task, onSave, onClose }: EditTaskDialogProps) {
  const [contractAddress, setContractAddress] = useState(task.contractAddress);
  const [functionName, setFunctionName] = useState(task.functionName);
  const [interval, setIntervalVal] = useState(task.interval.toString());
  const [gasBalance, setGasBalance] = useState(task.gasBalance.toString());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...task,
      contractAddress,
      functionName,
      interval: Number(interval) || task.interval,
      gasBalance: Number(gasBalance) || task.gasBalance,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-dialog-title"
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4"
      >
        <h2 id="edit-dialog-title" className="text-lg font-bold text-neutral-100">
          Edit Task #{task.id}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="edit-contract"
              className="block text-xs font-medium text-neutral-400 mb-1"
            >
              Target Contract Address
            </label>
            <input
              id="edit-contract"
              type="text"
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value)}
              required
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 outline-none focus:border-blue-500 font-mono text-sm text-neutral-100"
            />
          </div>

          <div>
            <label
              htmlFor="edit-function"
              className="block text-xs font-medium text-neutral-400 mb-1"
            >
              Function Name
            </label>
            <input
              id="edit-function"
              type="text"
              value={functionName}
              onChange={(e) => setFunctionName(e.target.value)}
              required
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 outline-none focus:border-blue-500 font-mono text-sm text-neutral-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="edit-interval"
                className="block text-xs font-medium text-neutral-400 mb-1"
              >
                Interval (seconds)
              </label>
              <input
                id="edit-interval"
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setIntervalVal(e.target.value)}
                required
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 outline-none focus:border-blue-500 font-mono text-sm text-neutral-100"
              />
            </div>
            <div>
              <label
                htmlFor="edit-gas"
                className="block text-xs font-medium text-neutral-400 mb-1"
              >
                Gas Balance (XLM)
              </label>
              <input
                id="edit-gas"
                type="number"
                min={0}
                value={gasBalance}
                onChange={(e) => setGasBalance(e.target.value)}
                required
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2.5 outline-none focus:border-blue-500 font-mono text-sm text-neutral-100"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Save Changes
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
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

        {/* Badges container */}
        <div className="flex flex-col items-end gap-1.5">
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

          {/* ZK verification status badge */}
          {task.zkVerified && (
            <span
              role="status"
              aria-label="Task secured with Zero-Knowledge proof"
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/20 shadow-sm shadow-violet-500/5 animate-pulse"
            >
              🛡️ ZK Protected
            </span>
          )}
        </div>
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
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  /* Helper to announce screen-reader messages */
  const announce = useCallback((msg: string) => {
    setAnnouncement("");
    // Defer to guarantee the aria-live region fires even for identical strings
    requestAnimationFrame(() => setAnnouncement(msg));
  }, []);

  const handleConnectWallet = useCallback(() => {
    if (isWalletConnected) {
      setIsWalletConnected(false);
      setWalletAddress(null);
      announce("Wallet disconnected.");
    } else {
      setIsWalletConnected(true);
      setWalletAddress("GA32V4M6P7Z8Q9X1Y2Z3A4B5C6D7E8F9G0H1I2J3");
      announce("Wallet connected successfully.");
    }
  }, [isWalletConnected, announce]);

  const handleZkVerified = useCallback((taskId: number, conditionHash: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, zkVerified: true, zkConditionHash: conditionHash } : t
      )
    );
  }, []);

  /* ── Create-task form state ── */
  const [contractAddress, setContractAddress] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [interval, setIntervalVal] = useState("");
  const [gasBalance, setGasBalance] = useState("");
  const [formError, setFormError] = useState("");

  const nextId = useRef(1);

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
              onClick={handleConnectWallet}
              aria-label={isWalletConnected ? `Disconnect wallet ${walletAddress?.slice(0, 6)}...` : "Connect your Stellar wallet"}
              className="bg-neutral-100 text-neutral-900 px-4 py-2 rounded-md font-medium hover:bg-neutral-200 transition-colors text-sm"
            >
              {isWalletConnected ? `${walletAddress?.slice(0, 6)}...${walletAddress?.slice(-4)}` : "Connect Wallet"}
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

          {/* ── Zero-Knowledge Proof Verification Section ── */}
          <section className="mt-16">
            <ZKProofVerification
              tasks={tasks.map((t) => ({
                id: t.id,
                contractAddress: t.contractAddress,
                functionName: t.functionName,
                interval: t.interval,
                gasBalance: t.gasBalance,
                status: t.status,
              }))}
              walletConnected={isWalletConnected}
              walletAddress={walletAddress}
              onZkVerified={handleZkVerified}
              onAddLog={(log) => {
                const newLog: LogEntry = {
                  id: `log-${Math.random().toString(36).substring(2, 6)}`,
                  taskId: Number(log.taskId.replace("#", "")),
                  target: log.target,
                  keeper: log.keeper,
                  status: log.status,
                  timestamp: log.timestamp,
                };
                setLogs((prev) => [newLog, ...prev]);
              }}
            />
          </section>

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
