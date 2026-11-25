import { groth16 } from "snarkjs";
import type {
  ZkProverWorkerRequest,
  ZkProverWorkerResponse,
} from "./browser-prover";

interface ZkWorkerScope {
  location: { origin: string };
  onmessage: ((event: MessageEvent<ZkProverWorkerRequest>) => void) | null;
  postMessage: (message: ZkProverWorkerResponse) => void;
}

const workerScope = self as unknown as ZkWorkerScope;

workerScope.onmessage = async (event: MessageEvent<ZkProverWorkerRequest>) => {
  const request = event.data;
  const startedAt = performance.now();
  const sendProgress = (stage: string, progress: number) => {
    const response: ZkProverWorkerResponse = {
      id: request.id,
      type: "progress",
      stage,
      progress,
    };
    workerScope.postMessage(response);
  };

  try {
    sendProgress("Loading circuit and proving key", 5);
    for (const artifactUrl of Object.values(request.artifacts)) {
      if (new URL(artifactUrl).origin !== workerScope.location.origin) {
        throw new Error("Circuit artifacts must be loaded from this application’s origin.");
      }
    }
    await Promise.all(
      Object.entries(request.artifacts).map(async ([name, url]) => {
        const response = await fetch(url, {
          method: "HEAD",
          credentials: "omit",
          cache: "force-cache",
        });
        if (!response.ok) {
          throw new Error(
            `Circuit ${name} is unavailable (${response.status}). Install the generated ${request.circuitId} circuit artifacts under public/zk-proofs.`,
          );
        }
      }),
    );
    const verificationKeyResponse = await fetch(request.artifacts.verificationKey, {
      credentials: "omit",
      cache: "force-cache",
    });
    if (!verificationKeyResponse.ok) {
      throw new Error(
        `Circuit verification key is unavailable (${verificationKeyResponse.status}). Install the generated ${request.circuitId} circuit artifacts under public/zk-proofs.`,
      );
    }
    const verificationKey = (await verificationKeyResponse.json()) as Record<string, unknown>;

    sendProgress("Computing private witness", 15);
    const { proof, publicSignals } = await groth16.fullProve(
      request.inputs,
      request.artifacts.wasm,
      request.artifacts.zkey,
      { debug: () => sendProgress("generating_proof", 60) },
    );

    sendProgress("Verifying proof locally", 90);
    const isValid = await groth16.verify(verificationKey, publicSignals, proof);
    if (!isValid) {
      throw new Error("The generated proof did not verify against this circuit's verification key.");
    }

    const payload = {
      proofId: crypto.randomUUID(),
      status: "success" as const,
      pi_a: proof.pi_a.slice(0, 2).map(String),
      pi_b: proof.pi_b.slice(0, 2).map((point) => point.slice(0, 2).map(String)),
      pi_c: proof.pi_c.slice(0, 2).map(String),
      publicSignals: publicSignals.map(String),
      proof,
      durationMs: Math.round(performance.now() - startedAt),
    };
    const response: ZkProverWorkerResponse = {
      id: request.id,
      type: "result",
      proof: payload,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: ZkProverWorkerResponse = {
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : "Groth16 proof generation failed.",
    };
    workerScope.postMessage(response);
  }
};
