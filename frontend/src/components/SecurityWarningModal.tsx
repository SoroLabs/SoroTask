"use client";

import React from "react";
import { SecurityAuditResult } from "../lib/security/phishingDefense";

export interface SecurityWarningModalProps {
  audit: SecurityAuditResult;
  isOpen: boolean;
  onProceed: () => void;
  onCancel: () => void;
}

export function SecurityWarningModal({ audit, isOpen, onProceed, onCancel }: SecurityWarningModalProps) {
  if (!isOpen || audit.riskLevel === 'LOW') return null;

  const isCritical = audit.riskLevel === 'CRITICAL';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-red-500/50 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 text-red-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Security Alert: {audit.riskLevel} Risk Target</h3>
            <p className="text-xs text-red-400 font-mono truncate max-w-[260px]">{audit.address}</p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {audit.warnings.map((w, idx) => (
            <div key={idx} className="rounded-lg bg-red-950/40 border border-red-800/40 p-2.5 text-xs text-red-200">
              {w}
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            Abort Transaction
          </button>
          {!isCritical && (
            <button
              onClick={onProceed}
              className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500"
            >
              I Understand the Risks
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
