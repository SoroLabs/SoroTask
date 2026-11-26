"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import DateInput from "./components/DateInput";
import { PredictionCard } from "@/src/components/predictive-prefetch/PredictionCard";

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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    console.log('Task submitted:', taskData);
    // Handle task submission logic here
  };

  const onReset = () => {
    if (confirmDiscard()) setForm(EMPTY_FORM);
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <section className="theme-ambient relative isolate min-h-screen px-5 py-6 sm:px-8 lg:px-12">

        <nav className="theme-glass mx-auto flex w-full max-w-7xl items-center justify-between gap-4 rounded-full px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-3"
            aria-label="SoroTask home"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-emerald-300 text-lg font-black text-slate-950">
              S
            </span>
            <span>
              <span               className="block text-sm font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">
                SoroTask
              </span>
              <span className="block text-xs text-[var(--text-muted)]">
                Automation command center
              </span>
            </span>
          </Link>
          <div className="hidden items-center gap-2 text-sm text-[var(--text-secondary)] md:flex">
            <Link
              className="rounded-full px-3 py-2 transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              href="/dashboard"
              prefetch={true}
            >
              Dashboard
            </Link>
            <Link
              className="rounded-full px-3 py-2 transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              href="/marketplace"
              prefetch={true}
            >
              Marketplace
            </Link>
            <Link
              className="rounded-full px-3 py-2 transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              href="/settings"
            >
              Settings
            </Link>
          </div>
          <div className="flex items-center gap-3" data-tour="wallet-slot">
            <LanguageSelector />
            <ThemeToggle />
            <WalletNavSlot />
            <Link
              href="/tasks"
              prefetch={true}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-200"
            >
              Launch
              <FiArrowRight aria-hidden="true" data-rtl-flip />
            </Link>
          </div>
        </nav>

        <div className="mx-auto grid w-full max-w-7xl gap-10 pb-16 pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-20 lg:pt-20">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-sm font-medium text-[var(--text-primary)]">
              <FiZap aria-hidden="true" />
              MVP-ready automation control for Soroban teams
            </div>

            <h1 className="mt-7 max-w-4xl text-5xl font-black leading-[0.95] text-[var(--text-primary)] sm:text-6xl lg:text-7xl">
              Run onchain tasks without watching the clock.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--text-secondary)]">
              SoroTask gives teams one sharp surface to schedule contract calls,
              fund execution, monitor keepers, and catch failed workflows before
              they become expensive.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/tasks"
                prefetch={true}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-300 px-6 py-3 text-base font-bold text-slate-950 shadow-xl shadow-emerald-950/30 transition hover:-translate-y-0.5 hover:bg-emerald-200"
              >
                Create automation
                <FiArrowRight aria-hidden="true" data-rtl-flip />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-6 py-3 text-base font-semibold text-[var(--text-primary)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-[var(--bg-elevated)]"
              >
                View live dashboard
                <FiActivity aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="border-l border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3"
                >
                  <p className="text-2xl font-black text-[var(--accent)]">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="theme-glass rounded-[2rem] p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--accent)]">
                    Execution stream
                  </p>
                  <h2 className="mt-1 text-2xl font-black text-[var(--text-primary)]">
                    Keeper cockpit
                  </h2>
                </div>
                <span className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)]">
                  Live
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-emerald-300 p-4 text-slate-950">
                  <p className="text-xs font-bold uppercase tracking-[0.2em]">
                    Balance
                  </p>
                  <p className="mt-3 text-3xl font-black">842 XLM</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                    Retries
                  </p>
                  <p className="mt-3 text-3xl font-black text-[var(--text-primary)]">03</p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                    Risk
                  </p>
                  <p className="mt-3 text-3xl font-black text-[var(--text-primary)]">Low</p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {commandRows.map((row) => (
                  <div
                    key={row.name}
                    className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`size-3 rounded-full ${row.tone}`} />
                      <div>
                        <p className="font-semibold text-[var(--text-primary)]">{row.name}</p>
                        <p className="text-sm text-[var(--text-secondary)]">{row.network}</p>
                      </div>
                    </div>
                    <span className="w-fit rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-sm font-medium text-[var(--text-primary)]">
                      {row.status}
                    </span>
                    <span className="text-sm font-semibold text-[var(--text-secondary)]">
                      ETA {row.eta}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

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
      if (!Number.isFinite(Number(interval)) || Number(interval) < 60) {
        setFormError("Interval must be at least 60 seconds.");
        return;
      }
      if (
        !gasBalance.trim() ||
        !Number.isFinite(Number(gasBalance)) ||
        Number(gasBalance) < 0.1
      ) {
        setFormError("Gas balance must be at least 0.1 XLM.");
        return;
      }

      const newTask: Task = {
        id: nextId.current++,
        contractAddress: contractAddress.trim(),
        functionName: functionName.trim(),
        interval: Number(interval),
        gasBalance: Number(gasBalance),
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
                key={item.label}
                className="flex items-center gap-3 border-t border-[var(--border)] pt-5 text-[var(--text-secondary)]"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--accent)]">
                  <Icon aria-hidden="true" />
                </span>
                <span className="font-medium">{item.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-[var(--bg-base)] px-5 py-16 text-[var(--text-primary)] sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-7xl">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.28em] text-[var(--accent)]">
                Operate faster
              </p>
              <h2 className="mt-3 max-w-2xl text-4xl font-black leading-tight sm:text-5xl">
                Everything an MVP demo needs on the first screen.
              </h2>
            </div>
            <p className="max-w-xl text-base leading-7 text-[var(--text-secondary)]">
              These routes turn the homepage from a blank entry point into a
              guided product hub, so users immediately know where to create,
              monitor, and debug automations.
            </p>
          </div>

          <div
            className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
            data-tour="quick-links"
          >
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl"
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
                        onChange={(e) => {
                          setContractAddress(e.target.value);
                          setFormError("");
                        }}
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
                        onChange={(e) => {
                          setFunctionName(e.target.value);
                          setFormError("");
                        }}
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
                          min={60}
                          value={interval}
                          onChange={(e) => {
                            setIntervalVal(e.target.value);
                            setFormError("");
                          }}
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
                          min={0.1}
                          step={0.1}
                          value={gasBalance}
                          onChange={(e) => {
                            setGasBalance(e.target.value);
                            setFormError("");
                          }}
                          className="w-full bg-neutral-900 border border-neutral-700/50 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <PredictionCard
                        input={{ contractAddress, functionName, interval, gasBalance }}
                      />
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
                  <h3 className="mt-6 text-xl font-black">{link.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                    {link.description}
                  </p>
                  <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]">
                    Open workspace
                    <FiArrowRight
                      className="transition group-hover:translate-x-1"
                      aria-hidden="true"
                      data-rtl-flip
                    />
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="theme-glass mt-10 grid gap-4 rounded-[2rem] p-5 lg:grid-cols-[0.75fr_1.25fr] lg:p-7">
            <div className="flex flex-col justify-between gap-8">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.24em] text-[var(--accent)]">
                  Launch checklist
                </p>
                <h3 className="mt-3 text-3xl font-black">
                  Built to show momentum.
                </h3>
                <p className="mt-4 leading-7 text-[var(--text-secondary)]">
                  A stronger homepage helps your MVP feel intentional while the
                  deeper product screens continue doing the actual work.
                </p>
              </div>
              <Link
                href="/template-builder"
                className="inline-flex w-fit items-center gap-2 rounded-full bg-amber-300 px-5 py-3 font-bold text-slate-950 transition hover:bg-amber-200"
              >
                Build a template
                <FiArrowRight aria-hidden="true" data-rtl-flip />
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {["Connect wallet", "Register task", "Watch execution"].map(
                (step, index) => (
                  <div
                    key={step}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5"
                  >
                    <FiCheckCircle
                      className="text-2xl text-[var(--accent)]"
                      aria-hidden="true"
                    />
                    <p className="mt-6 text-sm font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                      Step {index + 1}
                    </p>
                    <p className="mt-2 text-xl font-black">{step}</p>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      <ProductTour />
    </main>
  );
}
