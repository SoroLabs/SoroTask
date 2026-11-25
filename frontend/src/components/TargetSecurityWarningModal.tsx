'use client';

/**
 * TargetSecurityWarningModal (issue #1247)
 *
 * Pre-flight security modal shown before a task is pointed at a contract the
 * scanner flagged. A critical finding must be explicitly acknowledged — the
 * "Continue anyway" action is a deliberate override, not a default.
 */

import { useState } from 'react';
import { Modal, ModalFooter } from '@/components/Modal';
import type { TargetScanResult } from '@/src/lib/phishing-mitigation';

export interface TargetSecurityWarningModalProps {
  open: boolean;
  scan: TargetScanResult;
  onClose: () => void;
  /** Called only when the user explicitly accepts the risk. */
  onProceed: () => void;
}

const SEVERITY_STYLES = {
  critical: 'border-red-500/40 bg-red-500/10 text-red-200',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  info: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
} as const;

const SEVERITY_LABELS = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Note',
} as const;

export function TargetSecurityWarningModal({
  open,
  scan,
  onClose,
  onProceed,
}: TargetSecurityWarningModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  // A critical finding must be ticked before the override unlocks.
  const blocked = scan.requiresConfirmation && !acknowledged;

  const handleProceed = () => {
    if (blocked) return;
    setAcknowledged(false);
    onProceed();
  };

  const handleClose = () => {
    setAcknowledged(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={scan.riskLevel === 'high' ? 'High-risk contract' : 'Unverified contract'}
      description={`Review this before signing. Funds will be sent to the contract below on every run.`}
      size="md"
    >
      <div className="space-y-4">
        {/* Always show the full address: the user must be able to compare it
            against what they intended, character by character. */}
        <div className="rounded-lg border border-neutral-700 bg-neutral-950/60 p-3">
          <p className="text-xs text-neutral-400">Target contract address</p>
          <p className="mt-1 break-all font-mono text-xs text-neutral-100" data-testid="target-address">
            {scan.address || '—'}
          </p>
        </div>

        {scan.findings.length > 0 ? (
          <ul className="space-y-2" data-testid="target-findings">
            {scan.findings.map((finding) => (
              <li
                key={`${finding.code}-${finding.message}`}
                className={`rounded-lg border p-3 text-sm ${SEVERITY_STYLES[finding.severity]}`}
              >
                <span className="font-semibold">{SEVERITY_LABELS[finding.severity]}: </span>
                {finding.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-emerald-300">
            No issues were found with this contract.
          </p>
        )}

        {scan.requiresConfirmation ? (
          <label className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-100">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 rounded border-red-400 bg-transparent text-red-500 focus:ring-red-500"
              data-testid="target-acknowledge"
            />
            <span>
              I understand the risk above and want to send funds to this contract anyway.
            </span>
          </label>
        ) : null}
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleProceed}
          disabled={blocked}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="target-proceed"
        >
          {scan.riskLevel === 'high' ? 'Continue anyway' : 'Continue'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

export default TargetSecurityWarningModal;
