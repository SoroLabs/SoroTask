import {
  Account,
  Address,
  Contract,
  nativeToScVal,
  rpc,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { xdr } from "@stellar/stellar-sdk";
import { NETWORK_CONFIGS, type SorobanNetwork } from "./types";

const STROOPS_PER_XLM = 10_000_000;
const ARGUMENT_TYPE_NAMES = new Set([
  "address",
  "i128",
  "i256",
  "i32",
  "i64",
  "symbol",
  "string",
  "u128",
  "u256",
  "u32",
  "u64",
]);

export interface TaskSimulationInput {
  contractId: string;
  functionName: string;
  functionArgs: string;
  sourceAddress: string;
  network: SorobanNetwork;
}

export interface TaskSimulationResult {
  minResourceFeeStroops: string;
  networkFeeStroops: string;
  totalFeeStroops: string;
  cpuInstructions: number;
  storageReadBytes: number;
  storageWriteBytes: number;
  readOnlyEntries: number;
  readWriteEntries: number;
  stateChanges: { created: number; updated: number; removed: number };
  trace: Array<{ step: string; detail: string }>;
}

export async function simulateTaskCall(
  input: TaskSimulationInput,
): Promise<TaskSimulationResult> {
  const contractId = input.contractId.trim();
  const functionName = input.functionName.trim();
  const sourceAddress = input.sourceAddress.trim();

  if (!StrKey.isValidContract(contractId)) {
    throw new Error("Enter a valid Soroban contract address beginning with C.");
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(functionName)) {
    throw new Error("Enter a valid contract function name.");
  }
  if (!StrKey.isValidEd25519PublicKey(sourceAddress)) {
    throw new Error("Connect a valid Stellar account before simulating this call.");
  }

  const parsedArgs = parseFunctionArgs(input.functionArgs);
  const rpcConfig = NETWORK_CONFIGS[input.network];
  const server = new rpc.Server(rpcConfig.rpcUrl);
  const [account, feeStats] = await Promise.all([
    server.getAccount(sourceAddress),
    server.getFeeStats(),
  ]);

  const inclusionFee = feeStats.inclusionFee.p50;
  const transaction = new TransactionBuilder(
    new Account(sourceAddress, account.sequenceNumber()),
    {
      fee: inclusionFee,
      networkPassphrase: rpcConfig.networkPassphrase,
    },
  )
    .addOperation(
      new Contract(contractId).call(
        functionName,
        ...parsedArgs.map((argument) => toScVal(argument)),
      ),
    )
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error(getActionableFailure(simulation.error));
  }

  const transactionData = simulation.transactionData;
  const resources = transactionData.build().resources();
  const minResourceFeeStroops = simulation.minResourceFee;
  const networkFeeStroops = inclusionFee;
  const totalFeeStroops =
    (BigInt(minResourceFeeStroops) + BigInt(networkFeeStroops)).toString();
  const stateChanges = simulation.stateChanges ?? [];

  return {
    minResourceFeeStroops,
    networkFeeStroops,
    totalFeeStroops,
    cpuInstructions: Number(resources.instructions()),
    storageReadBytes: resources.diskReadBytes(),
    storageWriteBytes: resources.writeBytes(),
    readOnlyEntries: transactionData.getReadOnly().length,
    readWriteEntries: transactionData.getReadWrite().length,
    stateChanges: {
      created: stateChanges.filter(({ before, after }) => before === null && after !== null).length,
      updated: stateChanges.filter(({ before, after }) => before !== null && after !== null).length,
      removed: stateChanges.filter(({ before, after }) => before !== null && after === null).length,
    },
    trace: [
      {
        step: "Load source account",
        detail: `Account sequence ${account.sequenceNumber()}`,
      },
      {
        step: `Invoke ${functionName}`,
        detail: `Contract ${contractId}`,
      },
      {
        step: "Simulate against latest ledger",
        detail: `Ledger ${simulation.latestLedger}; ${simulation.events.length} diagnostic event(s); ${stateChanges.length} ledger change(s)`,
      },
      {
        step: "Calculate Soroban resource fee",
        detail: `${formatXlm(minResourceFeeStroops)} XLM`,
      },
    ],
  };
}

export function formatXlm(stroops: string): string {
  const amount = BigInt(stroops);
  const whole = amount / BigInt(STROOPS_PER_XLM);
  const fraction = (amount % BigInt(STROOPS_PER_XLM)).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

function parseFunctionArgs(argsJson: string): unknown[] {
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    throw new Error("Function arguments must be valid JSON.");
  }
  if (!Array.isArray(args)) {
    throw new Error("Function arguments must be a JSON array, such as [\"task-1\", 5].");
  }
  return args;
}

function toScVal(value: unknown): xdr.ScVal {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "__type" in value &&
    "value" in value
  ) {
    const typedValue = value as { __type: unknown; value: unknown };
    if (
      typeof typedValue.__type !== "string" ||
      !ARGUMENT_TYPE_NAMES.has(typedValue.__type)
    ) {
      throw new Error(`Unsupported contract argument type: ${String(typedValue.__type)}.`);
    }
    if (typedValue.__type === "address" && typeof typedValue.value === "string") {
      return Address.fromString(typedValue.value).toScVal();
    }
    return nativeToScVal(typedValue.value, {
      type: typedValue.__type as NonNullable<
        Parameters<typeof nativeToScVal>[1]
      >["type"],
    });
  }
  if (Array.isArray(value)) {
    return nativeToScVal(value.map((item) => toScVal(item)));
  }
  return nativeToScVal(value);
}

function getActionableFailure(error: string): string {
  const details = error.trim();
  const normalized = details.toLowerCase();
  let guidance =
    "Check that the contract is deployed on the selected network and that the function arguments match its interface.";

  if (/auth|authoriz|signature|soroban_auth/i.test(normalized)) {
    guidance = "The call needs authorization. Confirm the connected account and required contract permissions.";
  } else if (/insufficient|balance|underfund/i.test(normalized)) {
    guidance = "The source account may be unfunded. Fund it on the selected network and retry.";
  } else if (/budget|instruction|resource/i.test(normalized)) {
    guidance = "The call exceeded a Soroban resource limit. Reduce work or split the operation into smaller calls.";
  } else if (/contract|wasm|not found|no such/i.test(normalized)) {
    guidance = "Verify the contract address, selected network, and deployed function name.";
  }

  return `${details || "The Soroban RPC rejected the simulation."} ${guidance}`;
}
