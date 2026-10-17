"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FiTerminal, FiX } from "react-icons/fi";
import { useWallet } from "@/app/context/WalletContext";
import { SorobanService } from "@/app/lib/soroban.service";
import { listTasks, type RegisterTaskInput, type UpdateTaskInput } from "@/src/lib/mockApi/tasks";
import {
  useDeleteTask,
  useRegisterTask,
  useUpdateTask,
} from "@/src/hooks/tasks";
import {
  executeTerminalCommand,
  getTerminalCompletions,
  type TerminalApi,
} from "@/src/lib/terminal/commandEngine";

function safeTerminalText(value: string): string {
  return value
    .replace(/\x1b/g, "\uFFFD")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "\uFFFD");
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WebTerminal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const terminalElementRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef("");
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(0);
  const runningRef = useRef(false);
  const { session, openConnectModal } = useWallet();
  const registerTask = useRegisterTask();
  const updateTask = useUpdateTask();
  const removeTask = useDeleteTask();

  const api: TerminalApi = {
    listTasks,
    createTask: (input: RegisterTaskInput) => registerTask.mutateAsync(input),
    updateTask: (input: UpdateTaskInput) => updateTask.mutateAsync(input),
    deleteTask: (id: string) => removeTask.mutateAsync(id),
    simulate: async (contract: string, fn: string) => {
      if (!session) {
        openConnectModal();
        throw new Error("Connect a wallet to simulate a Soroban contract call.");
      }
      const service = new SorobanService(
        session.network.sorobanRpcUrl || undefined,
      );
      const prepared = await service.prepareContractCall({
        publicKey: session.address,
        contractId: contract,
        method: fn,
        networkPassphrase: session.network.networkPassphrase,
      });
      return `Simulation succeeded. Prepared transaction: ${prepared.toXDR()}`;
    },
  };
  const apiRef = useRef(api);
  apiRef.current = api;

  const runCommand = useCallback(async (value: string) => {
    const command = value.trim();
    inputBufferRef.current = "";
    if (!command || runningRef.current) return;

    const terminal = terminalRef.current;
    if (!terminal) return;
    historyRef.current.push(command);
    historyIndexRef.current = historyRef.current.length;
    terminal.write("\r\n");
    runningRef.current = true;
    setIsRunning(true);
    try {
      const result = await executeTerminalCommand(command, apiRef.current);
      if (result.clear) terminal.clear();
      else {
        for (const line of result.output) {
          terminal.writeln(safeTerminalText(line));
        }
      }
    } catch (error) {
      terminal.writeln(`\x1b[31m${safeTerminalText(displayError(error))}\x1b[0m`);
    } finally {
      runningRef.current = false;
      setIsRunning(false);
      terminal.write("\r\n\x1b[32msorotask>\x1b[0m ");
      terminal.focus();
    }
  }, []);

  const replaceInput = useCallback((value: string) => {
    inputBufferRef.current = value;
    terminalRef.current?.write(`\r\x1b[2K\x1b[32msorotask>\x1b[0m ${value}`);
  }, []);

  useEffect(() => {
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      scrollback: 1000,
      screenReaderMode: true,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
        cursor: "#34d399",
        green: "#6ee7b7",
        red: "#fda4af",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    if (terminalElementRef.current) terminal.open(terminalElementRef.current);
    terminal.writeln("SoroTask CLI · type help to get started");
    terminal.write("\x1b[32msorotask>\x1b[0m ");

    const dataSubscription = terminal.onData((data) => {
      if (data === "\r") {
        void runCommand(inputBufferRef.current);
      } else if (data === "\u0003") {
        inputBufferRef.current = "";
        terminal.write("^C\r\n\x1b[32msorotask>\x1b[0m ");
      } else if (data === "\u007f") {
        if (inputBufferRef.current.length) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          terminal.write("\b \b");
        }
      } else if (data === "\u001b[A") {
        const index = Math.max(0, historyIndexRef.current - 1);
        historyIndexRef.current = index;
        replaceInput(historyRef.current[index] ?? "");
      } else if (data === "\u001b[B") {
        const index = Math.min(
          historyRef.current.length,
          historyIndexRef.current + 1,
        );
        historyIndexRef.current = index;
        replaceInput(historyRef.current[index] ?? "");
      } else if (data === "\t") {
        const completions = getTerminalCompletions(inputBufferRef.current);
        if (completions.length === 1) {
          replaceInput(`${completions[0]} `);
        } else if (completions.length > 1) {
          terminal.writeln(`\r\n${completions.join("  ")}`);
          terminal.write(`\x1b[32msorotask>\x1b[0m ${inputBufferRef.current}`);
        }
      } else if (data >= " " && !data.startsWith("\u001b")) {
        inputBufferRef.current += data;
        terminal.write(data);
      }
    });

    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      dataSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [replaceInput, runCommand]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || (event.key !== "`" && event.code !== "Backquote")) {
        return;
      }
      event.preventDefault();
      setIsOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      terminalRef.current?.focus();
    });
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls="sorotask-terminal"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-white/20 bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-xl hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
      >
        <FiTerminal aria-hidden="true" />
        Terminal
        <kbd className="rounded border border-white/20 px-1.5 py-0.5 text-xs text-slate-300">
          Ctrl+`
        </kbd>
      </button>
      <section
        id="sorotask-terminal"
        role="region"
        aria-label="SoroTask interactive terminal"
        aria-hidden={!isOpen}
        className={`fixed inset-x-3 bottom-20 z-40 mx-auto flex h-[min(60vh,32rem)] max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl sm:inset-x-8 ${
          isOpen ? "" : "invisible"
        }`}
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FiTerminal aria-hidden="true" className="text-emerald-400" />
            SoroTask CLI
            <span className="font-normal text-slate-400">
              {session
                ? `· ${session.address.slice(0, 8)}…`
                : "· wallet not connected"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {isRunning && (
              <span role="status" className="text-xs text-slate-400">
                Running…
              </span>
            )}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close terminal"
              className="rounded p-2 text-slate-300 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
            >
              <FiX aria-hidden="true" />
            </button>
          </div>
        </header>
        <div
          ref={terminalElementRef}
          className="min-h-0 flex-1 px-3 py-2"
        />
      </section>
    </>
  );
}
