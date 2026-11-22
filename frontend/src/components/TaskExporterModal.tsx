"use client";

import React, { useState } from "react";
import { ExportTaskConfig, exportToJson, exportToTerraform } from "../lib/export/taskExporter";

export interface TaskExporterModalProps {
  tasks: ExportTaskConfig[];
  isOpen: boolean;
  onClose: () => void;
}

export function TaskExporterModal({ tasks, isOpen, onClose }: TaskExporterModalProps) {
  const [format, setFormat] = useState<"json" | "terraform">("json");
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const output = format === "json" ? exportToJson(tasks) : exportToTerraform(tasks);

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = `sorotask-export.${format === "json" ? "json" : "tf"}`;
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <h2 className="text-lg font-semibold text-white">Export Tasks as IaC</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">&times;</button>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setFormat("json")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold ${
              format === "json" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            JSON Configuration
          </button>
          <button
            onClick={() => setFormat("terraform")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold ${
              format === "terraform" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Terraform (HCL)
          </button>
        </div>

        <div className="mt-4">
          <textarea
            readOnly
            value={output}
            rows={12}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:outline-none"
          />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={handleCopy}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </button>
          <button
            onClick={handleDownload}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            Download {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
