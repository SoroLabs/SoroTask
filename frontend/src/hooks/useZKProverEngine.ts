"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserZkProver } from "@/src/lib/zk-proof/browser-prover";
import { ErrorTracker } from "@/src/lib/zk-proof/error-tracker";
import { ZkProofPipeline } from "@/src/lib/zk-proof/pipeline";
import type {
  ZkProofPayload,
  ZkProofGenerationOptions,
  ZkProofPipelineState,
} from "@/src/lib/zk-proof";

export interface UseZKProverEngineReturn {
  state: ZkProofPipelineState;
  isGenerating: boolean;
  isBusy: boolean;
  generateProof: (options: ZkProofGenerationOptions) => Promise<ZkProofPayload>;
  reset: () => void;
}

export function useZKProverEngine(): UseZKProverEngineReturn {
  const pipelineRef = useRef<ZkProofPipeline | null>(null);
  const proverRef = useRef<BrowserZkProver | null>(null);
  const errorTrackerRef = useRef<ErrorTracker | null>(null);

  if (!pipelineRef.current) {
    pipelineRef.current = new ZkProofPipeline();
  }
  if (!errorTrackerRef.current) {
    errorTrackerRef.current = new ErrorTracker({
      maxErrors: 100,
      onError: (error) => pipelineRef.current?.addError(error),
    });
  }
  if (!proverRef.current) proverRef.current = new BrowserZkProver();

  const pipeline = pipelineRef.current;
  const prover = proverRef.current;
  const errorTracker = errorTrackerRef.current;
  const [state, setState] = useState<ZkProofPipelineState>(() => ({
    ...pipeline.getState(),
  }));
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const unsubscribe = pipeline.subscribe(() => {
      setState({ ...pipeline.getState() });
    });
    return () => {
      unsubscribe();
      prover.terminate();
      errorTracker.clear();
      pipeline.reset();
    };
  }, [errorTracker, pipeline, prover]);

  const generateProof = useCallback(
    async (options: ZkProofGenerationOptions): Promise<ZkProofPayload> => {
      setIsGenerating(true);
      errorTracker.clear();
      pipeline.reset();
      pipeline.setStatus("generating");
      pipeline.addLog("initializing", "Starting local Groth16 proof generation in a browser worker.");
      try {
        const proof = await prover.generateProof(options, (stage, progress) => {
          const normalizedStage = stage.toLowerCase();
          const pipelineStage =
            normalizedStage.includes("witness")
              ? "computing_witness"
              : normalizedStage.includes("generating_proof")
                ? "computing_coefficients"
                : normalizedStage.includes("verifying")
                  ? "locally_verifying"
                  : "ingesting_data";
          pipeline.addLog(pipelineStage, stage, { progress });
          pipeline.setProgress(progress);
        });
        pipeline.setProof(proof);
        pipeline.addLog(
          "proof_complete",
          `Locally generated and verified Groth16 proof in ${proof.durationMs ?? 0} ms.`,
        );
        pipeline.setProgress(100);
        pipeline.setStatus("idle");
        return proof;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Groth16 proof generation failed.";
        if (message !== "Proof generation was cancelled.") {
          errorTracker.track(
            message,
            "generation",
            "Check the circuit inputs and confirm the audited WASM, proving key, and verification key are installed for the selected circuit.",
          );
          pipeline.addLog("failed", "Local Groth16 proof generation failed.");
          pipeline.setStatus("failed");
        }
        throw error;
      } finally {
        setIsGenerating(false);
      }
    },
    [errorTracker, pipeline, prover],
  );

  const reset = useCallback(() => {
    prover.terminate();
    errorTracker.clear();
    pipeline.reset();
    setIsGenerating(false);
  }, [errorTracker, pipeline, prover]);

  return {
    state,
    isGenerating,
    isBusy: isGenerating,
    generateProof,
    reset,
  };
}
