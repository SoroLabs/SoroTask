import {
  BrowserZkProver,
  combineCircuitInputs,
  type ZkProverWorkerLike,
  type ZkProverWorkerRequest,
  type ZkProverWorkerResponse,
} from "../browser-prover";
import type { ZkProofGenerationOptions, ZkProofPayload } from "../types";

const rangeOptions: ZkProofGenerationOptions = {
  taskCondition: '{"minValue":"1","maxValue":"10"}',
  secretData: '{"secretValue":"5"}',
  verifierAddress: "",
  simulateCongestion: false,
  simulateFailure: false,
  circuitId: "range",
};

const proof: ZkProofPayload = {
  proofId: "proof-1",
  status: "success",
  pi_a: ["1", "2"],
  pi_b: [["3", "4"], ["5", "6"]],
  pi_c: ["7", "8"],
  publicSignals: ["1", "10"],
  durationMs: 100,
};

const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const originalArtifactBase = process.env.NEXT_PUBLIC_ZK_ARTIFACT_BASE_URL;

function createWorker(
  handleRequest: (
    request: ZkProverWorkerRequest,
    worker: ZkProverWorkerLike,
  ) => void = (request, worker) => {
    worker.onmessage?.({
      data: { id: request.id, type: "result", proof },
    } as MessageEvent<ZkProverWorkerResponse>);
  },
): ZkProverWorkerLike {
  const worker: ZkProverWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (request) => handleRequest(request, worker),
    terminate: jest.fn(),
  };
  return worker;
}

describe("BrowserZkProver", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    delete process.env.NEXT_PUBLIC_ZK_ARTIFACT_BASE_URL;
  });

  afterEach(() => {
    if (originalWorkerDescriptor) {
      Object.defineProperty(globalThis, "Worker", originalWorkerDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "Worker");
    }
    if (originalArtifactBase === undefined) {
      delete process.env.NEXT_PUBLIC_ZK_ARTIFACT_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_ZK_ARTIFACT_BASE_URL = originalArtifactBase;
    }
  });

  it("sends validated inputs to its local worker and terminates it after completion", async () => {
    let request: ZkProverWorkerRequest | undefined;
    const worker = createWorker((message, target) => {
      request = message;
      target.onmessage?.({
        data: { id: message.id, type: "result", proof },
      } as MessageEvent<ZkProverWorkerResponse>);
    });
    const prover = new BrowserZkProver(() => worker);

    await expect(prover.generateProof(rangeOptions)).resolves.toEqual(proof);

    expect(request?.inputs).toEqual({
      minValue: "1",
      maxValue: "10",
      secretValue: "5",
    });
    expect(Object.values(request?.artifacts ?? {})).toHaveLength(3);
    expect(Object.values(request?.artifacts ?? {}).every((url) => new URL(url).origin === window.location.origin)).toBe(true);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("surfaces worker errors and always terminates the worker", async () => {
    const worker = createWorker((request, target) => {
      target.onmessage?.({
        data: { id: request.id, type: "error", error: "Proving key unavailable." },
      } as MessageEvent<ZkProverWorkerResponse>);
    });
    const prover = new BrowserZkProver(() => worker);

    await expect(prover.generateProof(rangeOptions)).rejects.toThrow("Proving key unavailable.");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin artifact hosts before constructing a worker", async () => {
    process.env.NEXT_PUBLIC_ZK_ARTIFACT_BASE_URL = "https://proof-artifacts.example/zk";
    const workerFactory = jest.fn(() => createWorker());
    const prover = new BrowserZkProver(workerFactory);

    await expect(prover.generateProof(rangeOptions)).rejects.toThrow(
      "ZK circuit artifacts must be served from this application’s origin.",
    );
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("rejects a second proof while a worker is active and cancels on terminate", async () => {
    const worker = createWorker(() => {});
    const prover = new BrowserZkProver(() => worker);
    const pending = prover.generateProof(rangeOptions);

    await expect(prover.generateProof(rangeOptions)).rejects.toThrow(
      "A proof is already being generated in this prover.",
    );
    prover.terminate();
    await expect(pending).rejects.toThrow("Proof generation was cancelled.");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});

describe("combineCircuitInputs", () => {
  it("combines valid public and private range inputs", () => {
    expect(
      combineCircuitInputs(
        '{"minValue":"2","maxValue":"8"}',
        '{"secretValue":"4"}',
        "range",
      ),
    ).toEqual({ minValue: "2", maxValue: "8", secretValue: "4" });
  });

  it.each([
    ["invalid JSON", "{", '{"secretValue":"4"}', "Public inputs must be valid JSON."],
    ["non-object input", "[]", '{"secretValue":"4"}', "Public inputs must be a JSON object."],
    [
      "missing range input",
      '{"minValue":"2"}',
      '{"secretValue":"4"}',
      'Missing public circuit input "maxValue".',
    ],
    [
      "duplicate input visibility",
      '{"minValue":"2","maxValue":"8","secretValue":"4"}',
      '{"secretValue":"4"}',
      "Input fields must not be both public and private: secretValue.",
    ],
    [
      "unknown circuit input",
      '{"minValue":"2","maxValue":"8","extra":"4"}',
      '{"secretValue":"4"}',
      'Unknown public input "extra" for the range circuit.',
    ],
    [
      "numeric JSON values",
      '{"minValue":2,"maxValue":"8"}',
      '{"secretValue":"4"}',
      'Range input "minValue" must be a non-negative integer string.',
    ],
    [
      "values exceeding comparator width",
      '{"minValue":"0","maxValue":"18446744073709551616"}',
      '{"secretValue":"4"}',
      "Range inputs must be smaller than 2^64.",
    ],
    [
      "inverted range",
      '{"minValue":"9","maxValue":"8"}',
      '{"secretValue":"4"}',
      "The minimum range value cannot exceed the maximum.",
    ],
  ])("rejects %s", (_label, publicInputs, privateInputs, message) => {
    expect(() => combineCircuitInputs(publicInputs, privateInputs, "range")).toThrow(message);
  });

  it("requires correctly shaped membership paths and field elements", () => {
    expect(() =>
      combineCircuitInputs(
        '{"root":"0"}',
        '{"leaf":"0","pathElements":[],"pathIndices":[]}',
        "membership",
      ),
    ).toThrow("Membership proofs require exactly 20 siblings and 20 direction bits");

    const pathElements = Array(20).fill("0");
    const pathIndices = Array(20).fill(0);
    pathIndices[0] = 2;
    expect(() =>
      combineCircuitInputs(
        '{"root":"0"}',
        JSON.stringify({ leaf: "0", pathElements, pathIndices }),
        "membership",
      ),
    ).toThrow("Membership proofs require exactly 20 siblings and 20 direction bits");
  });
});
