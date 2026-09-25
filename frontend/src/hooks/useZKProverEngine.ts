"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkMemoryBudget,
  encodeProofForSoroban,
  ProverEngine,
  proveInBrowser,
  type MemoryBudget,
  type SorobanProofBytes,
} from "@/src/lib/zk-proof";
import type {
  ZkTask,
  ZkProofPayload,
  ZkProofGenerationOptions,
  ZkVerificationResult,
  ZkProofPipelineState,
  ZkEngineConfig,
} from "@/src/lib/zk-proof";

export type { ZkEngineConfig };

const DEFAULT_CONFIG: ZkEngineConfig = {
  workerCount: 4,
  maxRetries: 3,
  baseDelayMs: 800,
  congestionMultiplier: 3,
};

export interface UseZKProverEngineReturn {
  engine: ProverEngine;
  state: ZkProofPipelineState;
  isGenerating: boolean;
  isVerifying: boolean;
  isBusy: boolean;
  generateProof: (options: ZkProofGenerationOptions) => Promise<ZkProofPayload>;
  verifyProof: (
    proof: ZkProofPayload,
    contractAddress: string,
    verifierAddress: string,
    walletAddress: string | null,
    walletConnected: boolean,
  ) => Promise<ZkVerificationResult>;
  reset: () => void;
  setTasks: (tasks: ZkTask[]) => void;
  workerStats: { idle: number; busy: number; total: number; queued: number };

  // In-browser WASM proving (Issue #1250)
  /**
   * Generate a proof in a dedicated worker. The private witness is passed to
   * the worker and never leaves the device.
   */
  generateProofInBrowser: (options: BrowserProofOptions) => Promise<SorobanProofBytes>;
  /** Whether this device is expected to complete a circuit of this size. */
  checkDeviceCapability: (constraintCount: number) => MemoryBudget;
  /** Stage and progress of an in-browser proof, while one is running. */
  browserProgress: { stage: string; progress: number } | null;
}

export interface BrowserProofOptions {
  /** Private witness. Never sent over the network. */
  input: Record<string, string | number | bigint>;
  wasmUrl: string;
  zkeyUrl: string;
  constraintCount?: number;
  timeoutMs?: number;
}

export function useZKProverEngine(
  config: Partial<ZkEngineConfig> = {},
): UseZKProverEngineReturn {
  const mergedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);
  const engineRef = useRef<ProverEngine | null>(null);
  const [state, setState] = useState<ZkProofPipelineState>({
    status: "idle",
    proof: null,
    logs: [],
    errors: [],
    currentStage: "idle",
    progress: 0,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [browserProgress, setBrowserProgress] = useState<{
    stage: string;
    progress: number;
  } | null>(null);

  if (!engineRef.current) {
    engineRef.current = new ProverEngine({
      config: mergedConfig,
      onStateChange: () => {
        if (engineRef.current) {
          setState({ ...engineRef.current.pipeline.getState() });
        }
      },
    });
  }

  const engine = engineRef.current;

  useEffect(() => {
    return () => {
      engine.shutdown();
    };
  }, [engine]);

  const generateProof = useCallback(
    async (options: ZkProofGenerationOptions): Promise<ZkProofPayload> => {
      setIsGenerating(true);
      try {
        const proof = await engine.generateProof(options);
        return proof;
      } finally {
        setIsGenerating(false);
      }
    },
    [engine],
  );

  const verifyProof = useCallback(
    async (
      proof: ZkProofPayload,
      contractAddress: string,
      verifierAddress: string,
      walletAddress: string | null,
      walletConnected: boolean,
    ): Promise<ZkVerificationResult> => {
      setIsVerifying(true);
      try {
        const result = await engine.verifyProof(
          proof,
          contractAddress,
          verifierAddress,
          walletAddress,
          walletConnected,
        );
        return result;
      } finally {
        setIsVerifying(false);
      }
    },
    [engine],
  );

  const reset = useCallback(() => {
    engine.pipeline.reset();
    setIsGenerating(false);
    setIsVerifying(false);
  }, [engine]);

  const setTasks = useCallback(
    (tasks: ZkTask[]) => {
      engine.setTasks(tasks);
    },
    [engine],
  );

  /**
   * Prove in a dedicated worker and return bytes the Soroban verifier accepts.
   *
   * Encoding happens here rather than at the call site so there is one place
   * the wire format is decided — a caller that serialised the raw snarkjs
   * output itself would produce a proof that submits and fails verification
   * with no diagnostic.
   */
  const generateProofInBrowser = useCallback(
    async (options: BrowserProofOptions): Promise<SorobanProofBytes> => {
      setIsGenerating(true);
      setBrowserProgress({ stage: "loading", progress: 0 });

      try {
        const result = await proveInBrowser({
          input: options.input,
          wasmUrl: options.wasmUrl,
          zkeyUrl: options.zkeyUrl,
          constraintCount: options.constraintCount,
          timeoutMs: options.timeoutMs,
          onProgress: (stage, progress) => setBrowserProgress({ stage, progress }),
        });

        const proof = result.proof as {
          pi_a: string[];
          pi_b: string[][];
          pi_c: string[];
        };

        return encodeProofForSoroban({
          proofId: `browser-${Date.now()}`,
          status: "success",
          pi_a: proof.pi_a,
          pi_b: proof.pi_b,
          pi_c: proof.pi_c,
          publicSignals: result.publicSignals,
        });
      } finally {
        setIsGenerating(false);
        setBrowserProgress(null);
      }
    },
    [],
  );

  const checkDeviceCapability = useCallback(
    (constraintCount: number) => checkMemoryBudget(constraintCount),
    [],
  );

  const isBusy = isGenerating || isVerifying;

  const workerStats = useMemo(() => engine.getWorkerPoolStats(), [engine]);

  return {
    engine,
    state,
    isGenerating,
    isVerifying,
    isBusy,
    generateProof,
    verifyProof,
    reset,
    setTasks,
    workerStats,
    generateProofInBrowser,
    checkDeviceCapability,
    browserProgress,
  };
}
