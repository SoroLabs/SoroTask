'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FiUsers, FiCpu, FiCheckCircle, FiClock, FiAlertCircle, FiWifi, FiLayers } from 'react-icons/fi';
import { CRDTDocumentManager } from '../lib/collaborative/crdtDocumentManager';
import type { CollaborativeUser, CollaborativeOperation } from '../lib/collaborative/types';

export interface CollaborativeWorkspaceProps {
  taskId: string;
  userId?: string;
  userName?: string;
  serverUrl?: string;
  onApplyParameters?: (params: Record<string, any>) => void;
}

export default function CollaborativeWorkspace({
  taskId,
  userId = `user-${Math.random().toString(36).slice(2, 7)}`,
  userName = 'Team Member',
  serverUrl = 'ws://localhost:1234',
  onApplyParameters,
}: CollaborativeWorkspaceProps) {
  const [manager, setManager] = useState<CRDTDocumentManager | null>(null);
  const [activeUsers, setActiveUsers] = useState<CollaborativeUser[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'syncing'>('disconnected');
  const [parameters, setParameters] = useState({
    contractAddress: '',
    functionName: '',
    callIntervalSeconds: '3600',
    gasLimitStroops: '500000',
    multisigThreshold: '2',
    payloadJson: '{\n  "memo": "multi-sig-automated-trigger"\n}',
  });
  const [history, setHistory] = useState<CollaborativeOperation[]>([]);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Initialize CRDT Document Manager
  useEffect(() => {
    const docManager = new CRDTDocumentManager({
      taskId,
      userId,
      userName,
      serverUrl,
      autoConnect: false,
      conflictResolutionStrategy: 'crdt',
    });

    setManager(docManager);

    // Initial state
    const state = docManager.getState();
    setConnectionStatus(state.connectionStatus);
    setActiveUsers(state.activeUsers);

    // Subscriptions
    const unsubSync = docManager.on('sync', () => {
      setConnectionStatus(docManager.getState().connectionStatus);
      setActiveUsers(docManager.getState().activeUsers);
      syncFieldsFromDoc(docManager);
    });

    const unsubUserJoined = docManager.on('userJoined', () => {
      setActiveUsers(docManager.getState().activeUsers);
    });

    const unsubUserLeft = docManager.on('userLeft', () => {
      setActiveUsers(docManager.getState().activeUsers);
    });

    const unsubOp = docManager.on('operation', () => {
      setHistory(docManager.getOperationHistory());
      syncFieldsFromDoc(docManager);
    });

    return () => {
      unsubSync();
      unsubUserJoined();
      unsubUserLeft();
      unsubOp();
      docManager.destroy();
    };
  }, [taskId, userId, userName, serverUrl]);

  const syncFieldsFromDoc = (docManager: CRDTDocumentManager) => {
    const remoteParams = docManager.getField(['automationParams']);
    if (remoteParams && typeof remoteParams === 'object') {
      setParameters((prev) => ({ ...prev, ...remoteParams }));
    }
  };

  const handleFieldChange = (field: string, value: string) => {
    setParameters((prev) => {
      const updated = { ...prev, [field]: value };
      if (manager) {
        manager.updateField(['automationParams'], updated);
      }
      return updated;
    });
  };

  const handleSaveAndApply = () => {
    if (onApplyParameters) {
      onApplyParameters(parameters);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="rounded-2xl border border-[var(--border,rgba(255,255,255,0.1))] bg-[var(--card,#0d1514)] p-6 text-slate-100 shadow-xl">
      {/* Header with Connection & Active User Presence */}
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-400">
            <FiLayers /> Multi-Sig CRDT Collaborative Workspace
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-white">
            Shared Automation Document (Task #{taskId})
          </h2>
        </div>

        {/* Presence Avatars & Connection Badge */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center -space-x-2">
            {activeUsers.length === 0 ? (
              <div
                className="flex size-8 items-center justify-center rounded-full border-2 border-[#0d1514] bg-teal-600 text-xs font-bold text-white shadow"
                title={`${userName} (You)`}
              >
                {userName.charAt(0).toUpperCase()}
              </div>
            ) : (
              activeUsers.map((user, idx) => (
                <div
                  key={user.clientId || idx}
                  className="flex size-8 items-center justify-center rounded-full border-2 border-[#0d1514] text-xs font-bold text-white shadow"
                  style={{ backgroundColor: user.color || '#0d9488' }}
                  title={`${user.userName} ${user.userId === userId ? '(You)' : ''}`}
                >
                  {user.userName.charAt(0).toUpperCase()}
                </div>
              ))
            )}
          </div>

          <div
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border ${
              connectionStatus === 'connected'
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                : connectionStatus === 'syncing'
                ? 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                : 'border-slate-500/20 bg-slate-500/10 text-slate-400'
            }`}
          >
            <FiWifi />
            <span className="capitalize">{connectionStatus}</span>
          </div>
        </div>
      </div>

      {/* Synchronized Collaborative Parameter Form */}
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
            Target Soroban Contract
          </label>
          <input
            type="text"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            placeholder="C... (56 chars contract address)"
            value={parameters.contractAddress}
            onChange={(e) => handleFieldChange('contractAddress', e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
            Invocation Entrypoint / Method
          </label>
          <input
            type="text"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            placeholder="e.g. execute_scheduled_swap"
            value={parameters.functionName}
            onChange={(e) => handleFieldChange('functionName', e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
            Execution Interval (Seconds)
          </label>
          <input
            type="number"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            value={parameters.callIntervalSeconds}
            onChange={(e) => handleFieldChange('callIntervalSeconds', e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
            Required Multi-Sig Signer Threshold
          </label>
          <input
            type="number"
            min="1"
            max="10"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3.5 py-2 text-sm text-white focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            value={parameters.multisigThreshold}
            onChange={(e) => handleFieldChange('multisigThreshold', e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium uppercase tracking-wider text-slate-400">
            Calldata Payload (Shared JSON Drafting)
          </label>
          <textarea
            rows={4}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-sm text-emerald-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            value={parameters.payloadJson}
            onChange={(e) => handleFieldChange('payloadJson', e.target.value)}
          />
        </div>
      </div>

      {/* Collaborative Status and 1-Click Action */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-white/10 pt-4">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <FiClock />
          <span>
            {history.length > 0
              ? `${history.length} CRDT operations synchronized with zero data loss`
              : 'Yjs CRDT synchronized in-memory. Edit changes propagate instantaneously.'}
          </span>
        </div>

        <button
          type="button"
          onClick={handleSaveAndApply}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-teal-400 active:scale-95"
        >
          {savedSuccess ? (
            <>
              <FiCheckCircle className="size-4" /> Parameters Applied!
            </>
          ) : (
            <>
              <FiCpu className="size-4" /> 1-Click Apply Parameters
            </>
          )}
        </button>
      </div>
    </div>
  );
}
