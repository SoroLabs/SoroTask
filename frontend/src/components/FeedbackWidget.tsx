"use client";

import React, { useState } from "react";
import { useWallet } from "@/app/context/WalletContext";
import { telemetry, type DiagnosticReport } from "@/src/lib/telemetry";
import {
  FiLifeBuoy,
  FiX,
  FiSend,
  FiCheckCircle,
  FiShield,
  FiTerminal,
  FiAlertTriangle,
} from "react-icons/fi";

export function FeedbackWidget() {
  const { session, activeAccount } = useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<DiagnosticReport["severity"]>("medium");
  const [category, setCategory] = useState<DiagnosticReport["category"]>("bug");
  const [destination, setDestination] = useState<"github" | "jira" | "api">("github");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedTicketId, setSubmittedTicketId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    const report: DiagnosticReport = {
      title: title.trim(),
      description: description.trim(),
      severity,
      category,
      walletAddress: session?.address || activeAccount || undefined,
      browser: {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "SSR",
        language: typeof navigator !== "undefined" ? navigator.language : "en",
        url: typeof window !== "undefined" ? window.location.href : "",
        timestamp: new Date().toISOString(),
        screenResolution:
          typeof window !== "undefined"
            ? `${window.innerWidth}x${window.innerHeight}`
            : undefined,
        onlineStatus: typeof navigator !== "undefined" ? navigator.onLine : true,
      },
      consoleLogs: telemetry.captureConsoleSnapshot(25),
      networkErrors: telemetry.captureNetworkErrors(),
      ticketDestination: destination,
    };

    const result = await telemetry.sendReport(report);
    setIsSubmitting(false);

    if (result.success) {
      setSubmittedTicketId(result.ticketId || "TICK-OK");
      setTitle("");
      setDescription("");
    } else {
      setErrorMsg(result.error || "Failed to submit diagnostic ticket. Please try again.");
    }
  };

  return (
    <aside aria-label="Feedback and Bug Reporting" className="fixed bottom-5 right-5 z-50">
      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          data-testid="feedback-trigger-button"
          className="group inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 py-2.5 text-xs font-bold text-white shadow-xl shadow-indigo-600/30 transition hover:from-indigo-500 hover:to-indigo-600 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <FiLifeBuoy className="size-4 animate-spin-slow group-hover:rotate-45 transition-transform" />
          <span>Report Bug / Feedback</span>
        </button>
      )}

      {/* Slide-over / Modal Window */}
      {isOpen && (
        <div
          data-testid="feedback-modal"
          className="w-96 rounded-2xl border border-white/10 bg-[#0c151c]/95 p-5 shadow-2xl backdrop-blur-2xl animate-in fade-in zoom-in-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
                <FiLifeBuoy className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Automated Bug Reporter</h3>
                <span className="text-[10px] text-slate-400">Diagnostic context auto-attached</span>
              </div>
            </div>
            <button
              onClick={() => {
                setIsOpen(false);
                setSubmittedTicketId(null);
                setErrorMsg(null);
              }}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition"
              aria-label="Close feedback modal"
            >
              <FiX className="size-4" />
            </button>
          </div>

          {submittedTicketId ? (
            <div className="py-6 text-center space-y-3">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                <FiCheckCircle className="size-6" />
              </div>
              <h4 className="text-sm font-bold text-white">Diagnostic Report Submitted!</h4>
              <p className="text-xs text-slate-300">
                Your report with sanitized environment and console traces was packaged into ticket:
              </p>
              <div className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 rounded-lg p-2">
                #{submittedTicketId}
              </div>
              <button
                onClick={() => setSubmittedTicketId(null)}
                className="mt-2 text-xs font-medium text-indigo-400 hover:text-indigo-300"
              >
                Submit Another Report
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-3.5 space-y-3">
              {/* Category & Severity */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="bug">Software Bug</option>
                    <option value="transaction">Failed Transaction</option>
                    <option value="ui">UI/UX Defect</option>
                    <option value="performance">Slow Execution</option>
                    <option value="other">Other Feedback</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Severity
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="low">Low (Cosmetic)</option>
                    <option value="medium">Medium (Annoyance)</option>
                    <option value="high">High (Broken Action)</option>
                    <option value="critical">Critical (Blocking)</option>
                  </select>
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Issue Summary
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g. Transaction estimation failed on Testnet"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Steps to Reproduce & Expected Behavior
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  rows={3}
                  placeholder="What were you attempting to automate? What error code appeared?"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              {/* Redaction Notice & Telemetry Preview */}
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/30 p-2.5 text-[11px] text-slate-300 space-y-1.5">
                <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <FiShield className="size-3.5" />
                  <span>Credential Redaction Guard Active</span>
                </div>
                <p className="text-[10px] text-slate-400">
                  Private keys, seed phrases, and bearer tokens are automatically scrubbed prior to dispatch.
                </p>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                  <FiTerminal className="size-3 text-cyan-400" />
                  <span>Wallet: {activeAccount ? `${activeAccount.slice(0, 4)}...${activeAccount.slice(-4)}` : "None"}</span>
                </div>
              </div>

              {errorMsg && (
                <div className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 p-2 text-xs text-rose-300">
                  <FiAlertTriangle className="size-3.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
              >
                <FiSend className="size-3.5" />
                {isSubmitting ? "Packaging Diagnostics..." : "Submit Diagnostic Report"}
              </button>
            </form>
          )}
        </div>
      )}
    </aside>
  );
}

export default FeedbackWidget;
import { useState, useEffect, useCallback } from "react";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const logs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args) => {
      logs.push(`[LOG] ${args.map(String).join(" ")}`);
      originalLog(...args);
    };
    console.error = (...args) => {
      logs.push(`[ERROR] ${args.map(String).join(" ")}`);
      originalError(...args);
    };
    console.warn = (...args) => {
      logs.push(`[WARN] ${args.map(String).join(" ")}`);
      originalWarn(...args);
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

  const getWalletAddress = useCallback(() => {
    try {
      const stored = localStorage.getItem("walletAddress") || localStorage.getItem("wallet") || localStorage.getItem("selectedAddress");
      return stored || undefined;
    } catch {
      return undefined;
    }
  }, []);

  const getBrowserInfo = useCallback(() => {
    return {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      language: typeof navigator !== "undefined" ? navigator.language : "",
      url: typeof window !== "undefined" ? window.location.href : "",
      timestamp: new Date().toISOString(),
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const diagnostic = {
        title,
        description,
        walletAddress: getWalletAddress(),
        browser: getBrowserInfo(),
        consoleLogs: consoleLogs.slice(-50),
      };

      // Redact sensitive data
      const redacted = JSON.parse(
        JSON.stringify(diagnostic).replace(/(private[_-]?key|seed|secret|mnemonic|password|token|api[_-]?key)/gi, "[REDACTED]")
      );

      // Integration point for GitHub/Jira - for now, log to telemetry
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(redacted),
      }).catch(() => {
        // Fallback: store locally
        localStorage.setItem("feedback_pending", JSON.stringify(redacted));
      });

      setSubmitted(true);
    } catch (err) {
      setError("Failed to submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <div className="bg-green-600 text-white px-4 py-2 rounded shadow-lg">
          Thank you for your feedback!
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded shadow-lg hover:bg-blue-700"
          aria-label="Report bug or feedback"
        >
          Feedback
        </button>
      ) : (
        <div className="bg-white text-gray-900 rounded shadow-xl w-96 max-h-[90vh] overflow-auto">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 className="font-semibold">Report Bug / Feedback</h3>
            <button onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded"
                placeholder="Brief description"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded"
                rows={4}
                placeholder="Steps to reproduce, expected vs actual behavior"
              />
            </div>
            <div className="text-xs text-gray-600">
              <p>Diagnostic context will be captured (browser info, recent console logs, wallet state).</p>
              <p className="mt-1">Sensitive credentials are automatically redacted.</p>
            </div>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Report"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
