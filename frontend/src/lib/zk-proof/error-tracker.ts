import type { DiagnosticError, ZkProofPhase } from "./types";

export interface ErrorTrackerConfig {
  maxErrors: number;
  onError?: (error: DiagnosticError) => void;
  onErrorLimitReached?: () => void;
}

export class ErrorTracker {
  private errors: DiagnosticError[] = [];
  private config: ErrorTrackerConfig;

  constructor(config: ErrorTrackerConfig) {
    this.config = {
      maxErrors: config.maxErrors,
      onError: config.onError,
      onErrorLimitReached: config.onErrorLimitReached,
    };
  }

  track(
    msg: string,
    phase: ZkProofPhase,
    remediation: string,
    metadata?: Record<string, unknown>,
  ): DiagnosticError {
    const error: DiagnosticError = {
      id: `err-${this.generateId()}`,
      msg,
      time: new Date().toISOString(),
      phase,
      remediation,
    };

    if (this.errors.length >= this.config.maxErrors) {
      this.errors.shift();
      this.config.onErrorLimitReached?.();
    }

    this.errors.unshift(error);
    this.config.onError?.(error);
    return error;
  }

  trackFromError(
    err: Error,
    phase: ZkProofPhase,
    remediation: string,
  ): DiagnosticError {
    return this.track(err.message, phase, remediation);
  }

  getErrors(): readonly DiagnosticError[] {
    return this.errors;
  }

  getErrorsByPhase(phase: ZkProofPhase): DiagnosticError[] {
    return this.errors.filter((e) => e.phase === phase);
  }

  getErrorCount(): number {
    return this.errors.length;
  }

  clear(): void {
    this.errors = [];
  }

  generateReport(): object {
    const counts = {
      generation: this.getErrorsByPhase("generation").length,
      verification: this.getErrorsByPhase("verification").length,
      network: this.getErrorsByPhase("network").length,
    };

    return {
      timestamp: new Date().toISOString(),
      totalErrors: this.errors.length,
      errorsByPhase: counts,
      errors: [...this.errors],
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  }
}
