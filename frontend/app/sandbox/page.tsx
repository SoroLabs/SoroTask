import Link from "next/link";
import { FiArrowLeft, FiCommand, FiTerminal } from "react-icons/fi";
import { WebTerminal } from "@/src/components/WebTerminal";

const commands = [
  {
    title: "Inspect tasks",
    command: "sorotask list",
    description: "List tasks; filter with --status pending.",
  },
  {
    title: "Register a task",
    command:
      "sorotask create --contract C... --fn method --interval 3600 --gas 10",
    description: "Create an automation with a positive interval and gas amount.",
  },
  {
    title: "Run a simulation",
    command: "sorotask simulate --contract C... --fn method",
    description: "Simulate a zero-argument call using your connected wallet.",
  },
];

export default function SandboxPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <FiArrowLeft aria-hidden="true" />
          Back to SoroTask
        </Link>
        <header className="mb-8 mt-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-sm text-[var(--muted-foreground)]">
            <FiTerminal aria-hidden="true" />
            Developer sandbox
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Interactive CLI
          </h1>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
            Manage task automations and simulate Soroban calls using a
            keyboard-driven command interface. The command parser accepts only
            documented SoroTask commands; it does not execute shell or
            JavaScript.
          </p>
        </header>

        <section
          aria-labelledby="sandbox-commands"
          className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-7"
        >
          <h2 id="sandbox-commands" className="text-lg font-semibold">
            Quick reference
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {commands.map((item) => (
              <article
                key={item.title}
                className="rounded-xl border border-[var(--border)] p-4"
              >
                <h3 className="font-semibold">{item.title}</h3>
                <code className="mt-3 block break-all rounded bg-black/10 p-2 text-xs">
                  {item.command}
                </code>
                <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
          <p className="mt-5 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <FiCommand aria-hidden="true" />
            Open or close the terminal with <kbd className="font-mono">Ctrl+`</kbd>.
            Use Tab for completion and ↑/↓ to browse command history.
          </p>
        </section>
      </div>
      <WebTerminal />
    </main>
  );
}
