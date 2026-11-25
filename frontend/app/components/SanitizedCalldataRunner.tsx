import React, { useState, useMemo } from 'react';
import { ContractCalldataSanitizer, SanitizationResult } from '../utils/contractSanitizer';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';

interface SanitizedCalldataRunnerProps {
    rawPayload: object;
    onExecuteValidTransaction: (cleanPayload: any) => Promise<void>;
}

export const SanitizedCalldataRunner: React.FC<SanitizedCalldataRunnerProps> = ({
    rawPayload,
    onExecuteValidTransaction,
}) => {
    const [executionState, setExecutionState] = useState<'idle' | 'processing' | 'success' | 'failed'>('idle');
    const [pipelineError, setPipelineError] = useState<string | null>(null);

    const sanitizerInstance = useMemo(() => new ContractCalldataSanitizer(), []);

    const handlePipelineProcessing = async () => {
        setPipelineError(null);
        setExecutionState('processing');

        // Execute step through safety pipeline
        const verification: SanitizationResult = sanitizerInstance.sanitize(rawPayload);

        if (!verification.isValid || !verification.sanitizedData) {
            setExecutionState('failed');
            setPipelineError(
                `[${verification.error?.code || 'ERROR'}] Validation Failure: ${verification.error?.message || 'Unknown verification error'}`
            );
            return;
        }

        try {
            // Forward verified payload into transaction build process
            await onExecuteValidTransaction(verification.sanitizedData);
            setExecutionState('success');
        } catch (contractError: any) {
            setExecutionState('failed');
            setPipelineError(`On-chain Runtime Exception: ${contractError.message || 'Transaction compilation rejected.'}`);
        }
    };

    return (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-5 shadow-sm text-white">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-slate-200">Strict Core Execution Sanitizer</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Pre-flight parameter checking for Soroban transaction pipelines</p>
                </div>
                <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-[10px] font-mono text-indigo-400 border border-indigo-500/20">
                    MVP-CRITICAL
                </span>
            </div>

            {/* Parameter Feedback Notice Panels */}
            {executionState === 'failed' && (
                <div className="mb-4 flex items-start gap-3 rounded-md bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-300">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                    <div>
                        <span className="font-bold uppercase tracking-wider block mb-0.5">Pipeline Boundary Triggered</span>
                        <p className="font-mono">{pipelineError}</p>
                    </div>
                </div>
            )}

            {executionState === 'success' && (
                <div className="mb-4 flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span>Payload clean. Parameters safely compiled to Soroban transaction space.</span>
                </div>
            )}

            <div className="flex justify-end">
                <button
                    type="button"
                    disabled={executionState === 'processing'}
                    onClick={handlePipelineProcessing}
                    className="flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-500 transition-colors"
                >
                    {executionState === 'processing' ? 'Processing Pre-flight Check...' : 'Sanitize & Broadcast Call'}
                </button>
            </div>
        </div>
    );
};