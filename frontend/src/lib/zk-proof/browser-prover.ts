import type {
  ZkCircuitId,
  ZkProofGenerationOptions,
  ZkProofPayload,
} from "./types";

export interface ZkArtifactSet {
  wasm: string;
  zkey: string;
  verificationKey: string;
}

export interface ZkProverWorkerRequest {
  id: string;
  circuitId: ZkCircuitId;
  inputs: Record<string, unknown>;
  artifacts: ZkArtifactSet;
}

export type ZkProverWorkerResponse =
  | { id: string; type: "progress"; stage: string; progress: number }
  | { id: string; type: "result"; proof: ZkProofPayload }
  | { id: string; type: "error"; error: string };

export interface ZkProverWorkerLike {
  onmessage: ((event: MessageEvent<ZkProverWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ZkProverWorkerRequest): void;
  terminate(): void;
}

export type ZkProverWorkerFactory = () => ZkProverWorkerLike;

const CIRCUIT_FILES: Record<ZkCircuitId, { wasm: string; zkey: string; verificationKey: string }> = {
  range: {
    wasm: "range-proof.wasm",
    zkey: "range-proof.zkey",
    verificationKey: "range-proof-verification_key.json",
  },
  membership: {
    wasm: "membership-proof.wasm",
    zkey: "membership-proof.zkey",
    verificationKey: "membership-proof-verification_key.json",
  },
};

const REQUIRED_INPUTS: Record<ZkCircuitId, { public: string[]; private: string[] }> = {
  range: {
    public: ["minValue", "maxValue"],
    private: ["secretValue"],
  },
  membership: {
    public: ["root"],
    private: ["leaf", "pathElements", "pathIndices"],
  },
};

const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export class BrowserZkProver {
  private workerFactory: ZkProverWorkerFactory;
  private worker: ZkProverWorkerLike | null = null;
  private rejectActive: ((error: Error) => void) | null = null;
  private workerTimeout: number | null = null;
  private requestSequence = 0;

  constructor(workerFactory: ZkProverWorkerFactory = createWorker) {
    this.workerFactory = workerFactory;
  }

  async generateProof(
    options: ZkProofGenerationOptions,
    onProgress?: (stage: string, progress: number) => void,
  ): Promise<ZkProofPayload> {
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      throw new Error("Client-side Web Workers are not available in this browser.");
    }
    if (this.worker) {
      throw new Error("A proof is already being generated in this prover.");
    }

    const circuitId = options.circuitId ?? "range";
    const inputs = combineCircuitInputs(options.taskCondition, options.secretData, circuitId);
    const artifacts = getCircuitArtifacts(circuitId);
    const id = `proof-${++this.requestSequence}`;
    const worker = this.workerFactory();
    this.worker = worker;

    try {
      return await new Promise<ZkProofPayload>((resolve, reject) => {
        this.rejectActive = (error) => {
          if (this.workerTimeout !== null) {
            window.clearTimeout(this.workerTimeout);
            this.workerTimeout = null;
          }
          reject(error);
        };
        this.workerTimeout = window.setTimeout(() => {
          this.rejectActive?.(new Error("Proof generation exceeded the 120-second worker limit."));
        }, 120_000);
        worker.onmessage = (event) => {
          const response = event.data;
          if (response.id !== id) return;
          if (response.type === "progress") {
            onProgress?.(response.stage, response.progress);
          } else if (response.type === "result") {
            if (this.workerTimeout !== null) window.clearTimeout(this.workerTimeout);
            this.workerTimeout = null;
            resolve(response.proof);
          } else {
            if (this.workerTimeout !== null) window.clearTimeout(this.workerTimeout);
            this.workerTimeout = null;
            reject(new Error(response.error));
          }
        };
        worker.onerror = (event) => {
          if (this.workerTimeout !== null) window.clearTimeout(this.workerTimeout);
          this.workerTimeout = null;
          reject(new Error(event.message || "The browser proof worker failed."));
        };
        worker.postMessage({ id, circuitId, inputs, artifacts });
      });
    } finally {
      if (this.worker === worker) {
        worker.terminate();
        this.worker = null;
      }
      if (this.workerTimeout !== null) window.clearTimeout(this.workerTimeout);
      this.workerTimeout = null;
      this.rejectActive = null;
    }
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectActive?.(new Error("Proof generation was cancelled."));
    this.rejectActive = null;
  }
}

export function combineCircuitInputs(
  publicInputsJson: string,
  privateInputsJson: string,
  circuitId: ZkCircuitId,
): Record<string, unknown> {
  const publicInputs = parseInputObject(publicInputsJson, "Public inputs");
  const privateInputs = parseInputObject(privateInputsJson, "Private inputs");
  const overlap = Object.keys(publicInputs).filter((key) => key in privateInputs);
  if (overlap.length > 0) {
    throw new Error(`Input fields must not be both public and private: ${overlap.join(", ")}.`);
  }

  const required = REQUIRED_INPUTS[circuitId];
  const allowedPublicKeys = new Set(required.public);
  const allowedPrivateKeys = new Set(required.private);
  const unknownPublicKey = Object.keys(publicInputs).find((key) => !allowedPublicKeys.has(key));
  const unknownPrivateKey = Object.keys(privateInputs).find((key) => !allowedPrivateKeys.has(key));
  if (unknownPublicKey) throw new Error(`Unknown public input "${unknownPublicKey}" for the ${circuitId} circuit.`);
  if (unknownPrivateKey) throw new Error(`Unknown private input "${unknownPrivateKey}" for the ${circuitId} circuit.`);
  for (const key of required.public) {
    if (!(key in publicInputs)) throw new Error(`Missing public circuit input "${key}".`);
  }
  for (const key of required.private) {
    if (!(key in privateInputs)) throw new Error(`Missing private circuit input "${key}".`);
  }

  if (circuitId === "range") {
    for (const key of ["minValue", "maxValue", "secretValue"]) {
      const value = key in publicInputs ? publicInputs[key] : privateInputs[key];
      if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new Error(`Range input "${key}" must be a non-negative integer string.`);
      }
      if (value.length > 20) throw new Error("Range inputs must be smaller than 2^64.");
    }
    const min = BigInt(String(publicInputs.minValue));
    const max = BigInt(String(publicInputs.maxValue));
    const secret = BigInt(String(privateInputs.secretValue));
    const maxFieldValue = 1n << 64n;
    if (min >= maxFieldValue || max >= maxFieldValue || secret >= maxFieldValue) {
      throw new Error("Range inputs must be smaller than 2^64.");
    }
    if (min > max) throw new Error("The minimum range value cannot exceed the maximum.");
  }

  if (circuitId === "membership") {
    if (!Array.isArray(privateInputs.pathElements) || !Array.isArray(privateInputs.pathIndices)) {
      throw new Error('Private membership inputs "pathElements" and "pathIndices" must be arrays.');
    }
    if (
      privateInputs.pathElements.length !== 20 ||
      privateInputs.pathIndices.length !== 20 ||
      !privateInputs.pathIndices.every((index) => index === 0 || index === 1)
    ) {
      throw new Error("Membership proofs require exactly 20 siblings and 20 direction bits (0 or 1).");
    }
    for (const [label, value] of [
      ["root", publicInputs.root],
      ["leaf", privateInputs.leaf],
      ...privateInputs.pathElements.map((value, index) => [`pathElements[${index}]`, value]),
    ]) {
      if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new Error(`Membership input "${label}" must be a decimal field-element string.`);
      }
      if (value.length > 77) {
        throw new Error(`Membership input "${label}" must be smaller than the BN254 scalar field.`);
      }
      if (BigInt(value) >= BN254_SCALAR_FIELD) {
        throw new Error(`Membership input "${label}" must be smaller than the BN254 scalar field.`);
      }
    }
  }

  return { ...publicInputs, ...privateInputs };
}

export function getCircuitArtifacts(circuitId: ZkCircuitId): ZkArtifactSet {
  const base = process.env.NEXT_PUBLIC_ZK_ARTIFACT_BASE_URL || "/zk-proofs";
  const files = CIRCUIT_FILES[circuitId];
  const origin = window.location.origin;

  const resolveArtifact = (file: string) => {
    const url = new URL(`${base.replace(/\/+$/, "")}/${file}`, origin);
    if (url.origin !== origin) {
      throw new Error("ZK circuit artifacts must be served from this application’s origin.");
    }
    return url.toString();
  };

  return {
    wasm: resolveArtifact(files.wasm),
    zkey: resolveArtifact(files.zkey),
    verificationKey: resolveArtifact(files.verificationKey),
  };
}

function parseInputObject(json: string, label: string): Record<string, unknown> {
  if (json.length > 16_384) {
    throw new Error(`${label} must be no larger than 16 KB.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function createWorker(): ZkProverWorkerLike {
  return new Worker(new URL("./zkProverWorker.ts", import.meta.url), {
    type: "module",
  }) as ZkProverWorkerLike;
}
