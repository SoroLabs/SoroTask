import type { ZkProofPayload, ZkVerificationResult, ZkProofPhase, DiagnosticError } from "./types";

export interface VerifierClientConfig {
  baseDelayMs: number;
  congestionMultiplier: number;
  simulateCongestion: boolean;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => void;
}

export type VerifierStage =
  | "preparing_credentials"
  | "computing_hash"
  | "simulating_ledger"
  | "broadcasting"
  | "verifying";

export class VerifierClient {
  private config: VerifierClientConfig;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(config: VerifierClientConfig) {
    this.config = config;
    this.now = config.now ?? (() => Date.now());
    this.schedule =
      config.schedule ??
      ((fn, ms) => {
        if (typeof window !== "undefined") window.setTimeout(fn, ms);
        else setTimeout(fn, ms);
      });
  }

  async verifyOnChain(
    proof: ZkProofPayload,
    contractAddress: string,
    verifierAddress: string,
    walletAddress: string | null,
    walletConnected: boolean,
    onStage?: (stage: string, message: string) => void,
  ): Promise<ZkVerificationResult> {
    const delay = this.config.simulateCongestion
      ? this.config.baseDelayMs * this.config.congestionMultiplier
      : this.config.baseDelayMs;

    return new Promise((resolve, reject) => {
      let cancelled = false;

      const stage1 = () => {
        if (cancelled) return;
        const currentAddress = walletConnected ? walletAddress : "GA32...XYZ9";
        onStage?.("preparing_credentials", `Wallet connection established using: ${currentAddress}`);
        this.schedule(stage2, delay / 5);
      };

      const stage2 = () => {
        if (cancelled) return;
        onStage?.("computing_hash", "Pre-computing ZK condition integrity hash...");
        const conditionHash = "h_" + Math.random().toString(36).substring(2, 14);
        onStage?.("computing_hash", `Condition Hash generated: ${conditionHash}`);
        this.schedule(stage3, delay / 5);
      };

      const stage3 = () => {
        if (cancelled) return;
        onStage?.("simulating_ledger", "Simulating CPU/RAM footprints on Futurenet ledger...");
        this.schedule(stage4, delay / 5);
      };

      const stage4 = () => {
        if (cancelled) return;
        onStage?.("broadcasting", "Broadcasting submit_zk_condition call...");
        this.schedule(stage5, delay / 5);
      };

      const stage5 = () => {
        if (cancelled) return;
        onStage?.("verifying", "Event captured: ZkConditionSubmitted (counter=42)");
        onStage?.("verifying", "Routing proof to verifier address for verification...");

        this.schedule(() => {
          if (cancelled) return;
          if (contractAddress.includes("FAILS")) {
            const error: DiagnosticError = {
              id: `err-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
              msg: "Soroban Transaction Revert: verify_zk_condition returned false due to proof vector verification failure",
              time: new Date().toISOString(),
              phase: "verification" as ZkProofPhase,
              remediation:
                "Verify that the verifier contract address is up-to-date and supports the current proof key schema.",
            };
            reject(error);
            return;
          }
          onStage?.("verifying", "Event captured: ZkConditionVerified (is_valid=true)");
          const conditionHash = "h_" + Math.random().toString(36).substring(2, 14);
          resolve({
            success: true,
            conditionHash,
            transactionHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
          });
        }, delay / 5);
      };

      onStage?.("preparing_credentials", "Preparing pre-flight credentials...");
      this.schedule(stage1, delay / 5);
    });
  }
}
