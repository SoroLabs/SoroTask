'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Keeper } from '../types';
import { WalletGate } from '@/app/components/WalletGate';

interface BidModalProps {
  keeper: Keeper | null;
  /** Pre-selected task id; user can override */
  defaultTaskId?: string;
  onConfirm: (keeper: Keeper, taskId: string, amountXlm: number) => void;
  onClose: () => void;
  /** External submission error, e.g. from placeBid */
  submitError?: string;
}

export function BidModal({ keeper, defaultTaskId = '', onConfirm, onClose, submitError }: BidModalProps) {
  const [taskId, setTaskId] = useState(defaultTaskId);
  const [amount, setAmount] = useState('');
  const [validationError, setValidationError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (keeper) {
      setTaskId(defaultTaskId);
      setAmount('');
      setValidationError('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [keeper, defaultTaskId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!keeper) return null;

  function validate(): boolean {
    const num = parseFloat(amount);
    if (!taskId.trim()) { setValidationError('Task ID is required.'); return false; }
    if (isNaN(num) || num <= 0) { setValidationError('Enter a positive bid amount.'); return false; }
    if (num < keeper!.minBidXlm) {
      setValidationError(`Minimum bid for this keeper is ${keeper!.minBidXlm} XLM.`);
      return false;
    }
    setValidationError('');
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    onConfirm(keeper!, taskId.trim(), parseFloat(amount));
  }

  const displayError = validationError || submitError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bid-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
          <h2 id="bid-modal-title" className="text-base font-semibold text-neutral-100">
            Place Bid — {keeper.label ?? keeper.address}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bid modal"
            className="text-neutral-500 hover:text-neutral-300 text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        {/* Wallet gate wraps the form */}
        <WalletGate message="Connect your wallet to place a bid.">
          <form onSubmit={handleSubmit} noValidate className="px-6 py-5 space-y-4">
            {/* Keeper summary */}
            <div className="bg-neutral-800/60 rounded-lg px-4 py-3 text-[12px] text-neutral-400 space-y-1">
              <div className="flex justify-between">
                <span>Tier</span>
                <span className="text-neutral-200 capitalize font-medium">{keeper.tier}</span>
              </div>
              <div className="flex justify-between">
                <span>Reliability</span>
                <span className="text-neutral-200 font-medium">{keeper.reliabilityScore}%</span>
              </div>
              <div className="flex justify-between">
                <span>Min bid</span>
                <span className="text-neutral-200 font-medium">{keeper.minBidXlm} XLM</span>
              </div>
              {!keeper.isOnline && (
                <p className="text-yellow-400 text-[11px] pt-1">⚠ This keeper is currently offline.</p>
              )}
            </div>

            {/* Task ID */}
            <div>
              <label htmlFor="bid-task-id" className="block text-xs font-medium text-neutral-300 mb-1">
                Task ID <span className="text-red-400">*</span>
              </label>
              <input
                id="bid-task-id"
                type="text"
                value={taskId}
                onChange={(e) => { setTaskId(e.target.value); setValidationError(''); }}
                placeholder="task-abc123"
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Amount */}
            <div>
              <label htmlFor="bid-amount" className="block text-xs font-medium text-neutral-300 mb-1">
                Bid amount (XLM) <span className="text-red-400">*</span>
              </label>
              <input
                id="bid-amount"
                ref={inputRef}
                type="number"
                min={keeper.minBidXlm}
                step="0.01"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setValidationError(''); }}
                placeholder={String(keeper.minBidXlm)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Error */}
            {displayError && (
              <p role="alert" className="text-[12px] text-red-400">
                {displayError}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 border border-neutral-700 hover:border-neutral-500 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!keeper.isOnline}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm Bid
              </button>
            </div>
          </form>
        </WalletGate>
      </div>
    </div>
  );
}
