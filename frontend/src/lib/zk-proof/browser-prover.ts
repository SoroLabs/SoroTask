import type { ProverRequest, ProverResponse } from "@/src/workers/zk-prover.worker";

/**
 * Main-thread side of the in-browser proving engine (Issue #1250).
 *
 * Owns the worker lifecycle, the memory budget, and the timeout. The worker
 * itself only proves; every policy decision about whether a proof should be
 * attempted lives here, where it can be tested without spawning one.
 */

export class ProverUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProverUnavailableError";
  }
}

export class ProverMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProverMemoryError";
  }
}

export interface MemoryBudget {
  /** Heap the proof is estimated to need, in MB. */
  requiredMb: number;
  /** Heap the device reports as available, in MB, or null if unknown. */
  availableMb: number | null;
  /** Whether the proof should be attempted. */
  sufficient: boolean;
  reason: string;
}

/**
 * Rough proving memory requirement, from the circuit's constraint count.
 *
 * Groth16 proving memory scales roughly linearly with constraints. The
 * coefficient is deliberately conservative: refusing a proof that would have
 * fitted is a worse outcome than a slow proof, but attempting one that crashes
 * the tab loses the user's unsaved inputs as well as the proof, so the bias is
 * toward refusing near the ceiling rather than crashing at it.
 */
export const MB_PER_MILLION_CONSTRAINTS = 900;
/** Floor covering the WASM runtime and the proving key regardless of size. */
export const BASE_PROVING_MEMORY_MB = 256;

export function estimateProvingMemoryMb(constraintCount: number): number {
  const constraints = Math.max(0, constraintCount);
  return Math.ceil(
    BASE_PROVING_MEMORY_MB + (constraints / 1_000_000) * MB_PER_MILLION_CONSTRAINTS,
  );
}

type DeviceMemoryNavigator = Navigator & { deviceMemory?: number };

/**
 * Check whether this device can be expected to complete the proof.
 *
 * `navigator.deviceMemory` is coarse (rounded to a power of two) and absent in
 * Safari and Firefox. Absence is treated as "proceed": refusing to prove on
 * every browser that does not implement a non-standard API would disable the
 * feature for most users, and the worker reports a real out-of-memory failure
 * distinctly if it happens.
 */
export function checkMemoryBudget(constraintCount: number): MemoryBudget {
  const requiredMb = estimateProvingMemoryMb(constraintCount);

  const deviceMemoryGb =
    typeof navigator !== "undefined"
      ? (navigator as DeviceMemoryNavigator).deviceMemory
      : undefined;

  if (typeof deviceMemoryGb !== "number" || deviceMemoryGb <= 0) {
    return {
      requiredMb,
      availableMb: null,
      sufficient: true,
      reason: "device memory is not reported by this browser; proceeding",
    };
  }

  // Only a fraction of device memory is available to one tab; the rest is the
  // browser, other tabs, and the OS.
  const availableMb = Math.floor(deviceMemoryGb * 1024 * 0.5);
  const sufficient = availableMb >= requiredMb;

  return {
    requiredMb,
    availableMb,
    sufficient,
    reason: sufficient
      ? `estimated ${requiredMb}MB against ${availableMb}MB usable`
      : `this circuit needs about ${requiredMb}MB and this device has roughly ` +
        `${availableMb}MB usable for the page`,
  };
}

export interface BrowserProveOptions {
  input: Record<string, string | number | bigint>;
  wasmUrl: string;
  zkeyUrl: string;
  /** Used for the memory check only; not sent to the worker. */
  constraintCount?: number;
  /** Abort and terminate the worker after this long. */
  timeoutMs?: number;
  onProgress?: (stage: string, progress: number) => void;
  /** Injectable for tests. */
  createWorker?: () => Worker;
}

/** A stuck proof holds a worker and its memory indefinitely without this. */
export const DEFAULT_PROVE_TIMEOUT_MS = 120_000;

export interface BrowserProveResult {
  proof: unknown;
  publicSignals: string[];
  durationMs: number;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL("@/src/workers/zk-prover.worker.ts", import.meta.url), {
    type: "module",
  });
}

/**
 * Generate a proof in a dedicated worker.
 *
 * The private input is passed to the worker and never returned; only the proof
 * and public signals come back.
 */
export function proveInBrowser(
  options: BrowserProveOptions,
): Promise<BrowserProveResult> {
  const {
    input,
    wasmUrl,
    zkeyUrl,
    constraintCount = 0,
    timeoutMs = DEFAULT_PROVE_TIMEOUT_MS,
    onProgress,
    createWorker = defaultWorkerFactory,
  } = options;

  // Only guard the default factory: an injected factory supplies its own
  // worker, and in a jsdom test there is no global `Worker` to find.
  if (createWorker === defaultWorkerFactory && typeof Worker === "undefined") {
    return Promise.reject(
      new ProverUnavailableError(
        "this browser does not support Web Workers, so proving cannot run off the main thread",
      ),
    );
  }

  const budget = checkMemoryBudget(constraintCount);
  if (!budget.sufficient) {
    // Refused before spawning: attempting it would crash the tab and lose the
    // user's unsaved inputs along with the proof.
    return Promise.reject(new ProverMemoryError(budget.reason));
  }

  return new Promise<BrowserProveResult>((resolve, reject) => {
    const requestId = `prove-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let worker: Worker;

    try {
      worker = createWorker();
    } catch (error) {
      reject(
        new ProverUnavailableError(
          error instanceof Error ? error.message : "could not start the proving worker",
        ),
      );
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(new Error(`proof generation exceeded ${timeoutMs}ms and was aborted`)),
      );
    }, timeoutMs);

    worker.addEventListener("message", (event: MessageEvent<ProverResponse>) => {
      const message = event.data;
      if (!message || message.requestId !== requestId) return;

      if (message.type === "progress") {
        onProgress?.(message.stage, message.progress);
        return;
      }

      if (message.type === "result") {
        finish(() =>
          resolve({
            proof: message.proof,
            publicSignals: message.publicSignals,
            durationMs: message.durationMs,
          }),
        );
        return;
      }

      finish(() =>
        reject(
          message.outOfMemory
            ? new ProverMemoryError(message.message)
            : new Error(message.message),
        ),
      );
    });

    worker.addEventListener("error", (event) => {
      finish(() =>
        reject(new ProverUnavailableError(event.message || "the proving worker failed")),
      );
    });

    const request: ProverRequest = {
      type: "generate",
      requestId,
      input,
      wasmUrl,
      zkeyUrl,
    };
    worker.postMessage(request);
  });
}
