import type {
  ZkProverWorkerRequest,
  ZkProverWorkerResponse,
} from "../browser-prover";

const mockFullProve = jest.fn();
const mockVerify = jest.fn();

jest.mock("snarkjs", () => ({
  groth16: {
    fullProve: (...args: unknown[]) => mockFullProve(...args),
    verify: (...args: unknown[]) => mockVerify(...args),
  },
}));

const generatedProof = {
  pi_a: ["1", "2", "1"],
  pi_b: [["3", "4"], ["5", "6"], ["1", "0"]],
  pi_c: ["7", "8", "1"],
};

const workerHarness: {
  location: { origin: string };
  onmessage: ((event: MessageEvent<ZkProverWorkerRequest>) => void) | null;
  postMessage: jest.Mock;
} = {
  location: { origin: "https://app.example" },
  onmessage: null,
  postMessage: jest.fn(),
};

const selfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
const randomUUIDDescriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");

function loadWorker() {
  jest.resetModules();
  workerHarness.onmessage = null;
  workerHarness.postMessage.mockClear();
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    writable: true,
    value: workerHarness,
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  jest.isolateModules(() => require("../zkProverWorker"));
}

function makeRequest(): ZkProverWorkerRequest {
  return {
    id: "proof-1",
    circuitId: "range",
    inputs: {
      minValue: "1",
      maxValue: "10",
      secretValue: "5",
    },
    artifacts: {
      wasm: "https://app.example/zk-proofs/range.wasm",
      zkey: "https://app.example/zk-proofs/range.zkey",
      verificationKey: "https://app.example/zk-proofs/range-verification_key.json",
    },
  };
}

describe("Groth16 proof worker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFullProve.mockResolvedValue({
      proof: generatedProof,
      publicSignals: ["1", "10"],
    });
    mockVerify.mockResolvedValue(true);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ protocol: "groth16" }),
      })),
    });
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: () => "generated-proof-id",
    });
    loadWorker();
  });

  afterAll(() => {
    if (selfDescriptor) Object.defineProperty(globalThis, "self", selfDescriptor);
    else Reflect.deleteProperty(globalThis, "self");
    if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    else Reflect.deleteProperty(globalThis, "fetch");
    if (randomUUIDDescriptor) Object.defineProperty(crypto, "randomUUID", randomUUIDDescriptor);
    else Reflect.deleteProperty(crypto, "randomUUID");
  });

  it("proves and verifies locally without including private inputs in network requests", async () => {
    await workerHarness.onmessage?.({
      data: makeRequest(),
    } as MessageEvent<ZkProverWorkerRequest>);

    expect(mockFullProve).toHaveBeenCalledWith(
      { minValue: "1", maxValue: "10", secretValue: "5" },
      "https://app.example/zk-proofs/range.wasm",
      "https://app.example/zk-proofs/range.zkey",
      expect.any(Object),
    );
    expect(mockVerify).toHaveBeenCalledWith(
      { protocol: "groth16" },
      ["1", "10"],
      generatedProof,
    );
    const networkRequests = (globalThis.fetch as jest.Mock).mock.calls;
    expect(networkRequests).toHaveLength(4);
    expect(JSON.stringify(networkRequests)).not.toContain("secretValue");
    expect(JSON.stringify(networkRequests)).not.toContain('"5"');

    const result = workerHarness.postMessage.mock.calls
      .map(([message]) => message as ZkProverWorkerResponse)
      .find((message) => message.type === "result");
    expect(result).toMatchObject({
      id: "proof-1",
      type: "result",
      proof: {
        proofId: "generated-proof-id",
        status: "success",
        publicSignals: ["1", "10"],
      },
    });
  });

  it("returns an explicit error when a circuit artifact is missing", async () => {
    (globalThis.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => ({
      ok: !(init?.method === "HEAD" && url.endsWith("range.wasm")),
      status: init?.method === "HEAD" && url.endsWith("range.wasm") ? 404 : 200,
      json: async () => ({ protocol: "groth16" }),
    }));

    await workerHarness.onmessage?.({
      data: makeRequest(),
    } as MessageEvent<ZkProverWorkerRequest>);

    expect(mockFullProve).not.toHaveBeenCalled();
    expect(
      workerHarness.postMessage.mock.calls
        .map(([message]) => message as ZkProverWorkerResponse)
        .some((message) => message.type === "error" && message.error.includes("wasm is unavailable (404)")),
    ).toBe(true);
  });

  it("rejects proofs that fail local verification", async () => {
    mockVerify.mockResolvedValue(false);

    await workerHarness.onmessage?.({
      data: makeRequest(),
    } as MessageEvent<ZkProverWorkerRequest>);

    expect(
      workerHarness.postMessage.mock.calls
        .map(([message]) => message as ZkProverWorkerResponse)
        .some((message) => message.type === "error" && message.error.includes("did not verify")),
    ).toBe(true);
  });
});
