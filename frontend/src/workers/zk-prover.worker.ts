/// <reference lib="webworker" />

/**
 * Dedicated proving worker (Issue #1250).
 *
 * Groth16 witness calculation and proving are CPU-bound and run for seconds.
 * On the main thread that is not slow UI, it is a frozen tab — no scroll, no
 * clicks, no spinner animation, for the entire proof. This runs it off the
 * main thread so the page stays responsive and the progress indicator keeps
 * moving.
 *
 * # Why snarkjs is imported dynamically
 *
 * The proving key and the snarkjs WASM are megabytes. A static import puts
 * them in the worker's initial fetch for every user, including everyone who
 * never generates a proof. Importing on the first proof request keeps the cost
 * on the users who ask for it.
 *
 * # Why the private witness never leaves here
 *
 * The whole point of proving client-side is that the witness stays on the
 * device. It is read from the incoming message, used, and never posted back —
 * only the proof and the public signals are returned. Any logging added to
 * this file must keep that true.
 */

export type ProverRequest = {
  type: "generate";
  requestId: string;
  /** Private witness. Never posted back to the main thread. */
  input: Record<string, string | number | bigint>;
  wasmUrl: string;
  zkeyUrl: string;
};

export type ProverResponse =
  | {
      type: "progress";
      requestId: string;
      stage: "loading" | "witness" | "proving";
      progress: number;
    }
  | {
      type: "result";
      requestId: string;
      proof: unknown;
      publicSignals: string[];
      durationMs: number;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
      /** True when the failure was a memory ceiling rather than a bad input. */
      outOfMemory: boolean;
    };

type SnarkjsModule = {
  groth16: {
    fullProve: (
      input: Record<string, unknown>,
      wasmUrl: string,
      zkeyUrl: string,
    ) => Promise<{ proof: unknown; publicSignals: string[] }>;
  };
};

let snarkjsPromise: Promise<SnarkjsModule> | null = null;

function loadSnarkjs(): Promise<SnarkjsModule> {
  if (!snarkjsPromise) {
    // Variable specifier keeps the bundler from trying to resolve snarkjs at
    // build time, so the app still builds in environments where the optional
    // proving dependency is not installed.
    const specifier = "snarkjs";
    snarkjsPromise = import(/* webpackIgnore: true */ specifier) as Promise<SnarkjsModule>;
  }
  return snarkjsPromise;
}

/**
 * Detect the two ways proving runs out of memory.
 *
 * A WASM memory ceiling and a JS heap exhaustion surface as different errors,
 * and neither is retryable in the way an ordinary failure is — retrying the
 * same proof on the same device will fail the same way. The caller needs to
 * tell them apart so it can suggest a smaller circuit rather than a retry.
 */
function isMemoryFailure(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /out of memory|memory access out of bounds|allocation failed|Maximum call stack/i.test(
    message,
  );
}

function post(message: ProverResponse): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
}

self.addEventListener("message", async (event: MessageEvent<ProverRequest>) => {
  const request = event.data;
  if (!request || request.type !== "generate") return;

  const startedAt = Date.now();

  try {
    post({ type: "progress", requestId: request.requestId, stage: "loading", progress: 0.1 });
    const snarkjs = await loadSnarkjs();

    post({ type: "progress", requestId: request.requestId, stage: "witness", progress: 0.3 });

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      request.input,
      request.wasmUrl,
      request.zkeyUrl,
    );

    post({ type: "progress", requestId: request.requestId, stage: "proving", progress: 0.9 });

    post({
      type: "result",
      requestId: request.requestId,
      proof,
      publicSignals,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    // The message is forwarded but the input is not: an error string built
    // from a failed witness calculation can contain witness values.
    post({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "proof generation failed",
      outOfMemory: isMemoryFailure(error),
    });
  }
});

export {};
