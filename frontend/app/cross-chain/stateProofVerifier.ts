import type { BridgeEvent, CrossChainTask, NetworkId } from "./types";

const DEFAULT_MAX_PROOF_AGE_MS = 60 * 60 * 1000;
const SENSITIVE_KEY_PATTERN = /(secret|private|seed|token|signature|credential|password)/i;

export type StateProofStatus = "verified" | "blocked" | "fallback";

export type StateProofCode =
  | "verified"
  | "invalid_json"
  | "invalid_schema"
  | "task_not_found"
  | "task_mismatch"
  | "network_mismatch"
  | "source_not_confirmed"
  | "bridge_event_missing"
  | "bridge_event_unsettled"
  | "stale_proof";

export type StateProofPayload = {
  proofId: string;
  taskId: string;
  sourceNetwork: NetworkId;
  targetNetwork: NetworkId;
  sourceTxHash: string;
  stateRoot: string;
  bridgeEventId: string;
  observedAt: string;
  signer?: string;
  [key: string]: unknown;
};

export type StateProofAudit = {
  taskId?: string;
  bridgeEventId?: string;
  sourceNetwork?: NetworkId;
  targetNetwork?: NetworkId;
  checkedAt: string;
  redactedProof: Record<string, unknown>;
};

export type StateProofVerificationResult = {
  status: StateProofStatus;
  code: StateProofCode;
  message: string;
  retriable: boolean;
  audit: StateProofAudit;
};

type VerifyStateProofInput = {
  rawProof: string;
  selectedTaskId?: string;
  tasks: CrossChainTask[];
  bridgeEvents: BridgeEvent[];
  now?: Date;
  maxProofAgeMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactProof(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : entry,
    ]),
  );
}

function makeAudit(proof: unknown, now: Date): StateProofAudit {
  const payload = isRecord(proof) ? proof : {};
  return {
    taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
    bridgeEventId: typeof payload.bridgeEventId === "string" ? payload.bridgeEventId : undefined,
    sourceNetwork: payload.sourceNetwork as NetworkId | undefined,
    targetNetwork: payload.targetNetwork as NetworkId | undefined,
    checkedAt: now.toISOString(),
    redactedProof: redactProof(payload),
  };
}

function result(
  status: StateProofStatus,
  code: StateProofCode,
  message: string,
  retriable: boolean,
  audit: StateProofAudit,
): StateProofVerificationResult {
  return { status, code, message, retriable, audit };
}

function parsePayload(value: unknown): StateProofPayload | null {
  if (!isRecord(value)) return null;

  const requiredFields = [
    "proofId",
    "taskId",
    "sourceNetwork",
    "targetNetwork",
    "sourceTxHash",
    "stateRoot",
    "bridgeEventId",
    "observedAt",
  ];

  const hasRequiredShape = requiredFields.every((field) => typeof value[field] === "string");
  if (!hasRequiredShape) return null;

  return value as StateProofPayload;
}

export function verifyStateProof({
  rawProof,
  selectedTaskId,
  tasks,
  bridgeEvents,
  now = new Date(),
  maxProofAgeMs = DEFAULT_MAX_PROOF_AGE_MS,
}: VerifyStateProofInput): StateProofVerificationResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawProof);
  } catch {
    return result(
      "blocked",
      "invalid_json",
      "Proof payload is not valid JSON.",
      true,
      makeAudit({}, now),
    );
  }

  const audit = makeAudit(parsed, now);
  const payload = parsePayload(parsed);
  if (!payload) {
    return result(
      "blocked",
      "invalid_schema",
      "Proof payload is missing required state proof fields.",
      true,
      audit,
    );
  }

  if (selectedTaskId && payload.taskId !== selectedTaskId) {
    return result(
      "blocked",
      "task_mismatch",
      "Proof task ID does not match the selected cross-chain task.",
      false,
      audit,
    );
  }

  const task = tasks.find((candidate) => candidate.id === payload.taskId);
  if (!task) {
    return result(
      "blocked",
      "task_not_found",
      "Proof references a task that is not loaded in the workspace.",
      true,
      audit,
    );
  }

  if (!task.networks.includes(payload.sourceNetwork) || !task.networks.includes(payload.targetNetwork)) {
    return result(
      "blocked",
      "network_mismatch",
      "Proof networks are not configured for the referenced task.",
      false,
      audit,
    );
  }

  const sourceStatus = task.chainStatuses[payload.sourceNetwork];
  if (sourceStatus?.status !== "confirmed" || sourceStatus.txHash !== payload.sourceTxHash) {
    return result(
      "fallback",
      "source_not_confirmed",
      "Source chain state is not confirmed with the supplied transaction hash.",
      true,
      audit,
    );
  }

  const bridgeEvent = bridgeEvents.find(
    (event) =>
      event.id === payload.bridgeEventId &&
      event.taskId === payload.taskId &&
      event.fromNetwork === payload.sourceNetwork &&
      event.toNetwork === payload.targetNetwork,
  );

  if (!bridgeEvent) {
    return result(
      "fallback",
      "bridge_event_missing",
      "No matching bridge event was found for this proof.",
      true,
      audit,
    );
  }

  if (bridgeEvent.eventType !== "settled") {
    return result(
      "fallback",
      "bridge_event_unsettled",
      "Bridge event has not settled on the target network.",
      true,
      audit,
    );
  }

  const observedAt = Date.parse(payload.observedAt);
  if (!Number.isFinite(observedAt) || now.getTime() - observedAt > maxProofAgeMs) {
    return result(
      "fallback",
      "stale_proof",
      "Proof observation is outside the accepted freshness window.",
      true,
      audit,
    );
  }

  return result(
    "verified",
    "verified",
    "State proof matches the selected task, source transaction, and settled bridge event.",
    false,
    audit,
  );
}
