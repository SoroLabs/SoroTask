/**
 * useTransactionSimulation.ts
 * Hook for automated pre-flight Soroban transaction simulation with exact
 * CPU instruction, RAM footprint, storage fee, and wallet balance checks.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  TransactionBuilder,
  Account,
  Contract,
  type xdr,
} from "@stellar/stellar-sdk/base";
import * as rpc from "@stellar/stellar-sdk/rpc";
import {
  mapContractError,
  SorobanContractError,
  type MappedContractError,
} from "@/src/lib/errors/contractErrors";
import { EXPECTED_NETWORK_PASSPHRASE } from "@/app/lib/wallet";

const STROOPS_PER_XLM = 10_000_000;
const DEFAULT_RPC_URL = "https://rpc-futurenet.stellar.org";
const FALLBACK_PUBLIC_KEY =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const BASE_FEE_STROOPS = 1_000; // 0.0001 XLM
const DEFAULT_STORAGE_DEPOSIT_XLM = 0.005;

export interface ItemizedFeeBreakdown {
  networkBaseFeeXlm: number;
  resourceFeeXlm: number;
  estimatedBountyXlm: number;
  storageDepositXlm: number;
  minGasRequirementXlm: number;
  totalXlm: number;
}

export interface ResourceCosts {
  cpuInstructions: number;
  ramBytes: number;
  readBytes: number;
  writeBytes: number;
  cpuFeeStroops: number;
  storageFeeStroops: number;
  minResourceFeeStroops: number;
}

export interface BalanceCheck {
  walletBalanceXlm: number | null;
  requiredXlm: number;
  insufficientBalance: boolean;
  shortfallXlm: number;
}

export interface SimulationResult {
  success: boolean;
  itemizedFees: ItemizedFeeBreakdown;
  transactionXdr?: string;
  errorMessage?: string;
  mappedError?: MappedContractError;
  diagnosticPayload?: unknown;
  warningMessage?: string;
  minFeeStroops?: string;
  /** Decoded resource consumption from simulateTransaction response */
  resources?: ResourceCosts;
  /** Wallet balance sufficiency check */
  balanceCheck?: BalanceCheck;
  /** Indicates if the simulation shows the transaction will revert */
  willRevert?: boolean;
  /** Whether the user should be allowed to proceed to wallet confirmation */
  canSubmit?: boolean;
  /** Raw Soroban simulation response for advanced debugging */
  rawSimulation?: unknown;
}

export interface SimulateTxInput {
  contractId: string;
  method: string;
  publicKey?: string;
  args?: xdr.ScVal[];
  bountyXlm?: number;
  walletBalanceXlm?: number;
  rpcUrl?: string;
  networkPassphrase?: string;
}

export interface UseTransactionSimulationOptions {
  rpcUrl?: string;
  autoSimulateInput?: SimulateTxInput | null;
  debounceMs?: number;
}

function parseNumeric(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return fallback;
}

function extractResourceCosts(
  simulation: rpc.Api.SimulateTransactionSuccessResponse,
): ResourceCosts {
  const simAny = simulation as unknown as {
    cost?: { cpuInsns?: string | number; memBytes?: string | number };
    minResourceFee?: string | number;
    restorePreamble?: { minResourceFee?: string | number };
    transactionData?: {
      build?: () => {
        resources?: () => {
          instructions?: () => number;
          readBytes?: () => number;
          writeBytes?: () => number;
        };
        resourceFee?: () => { toString: () => string };
      };
    };
  };

  let txResources:
    | {
        instructions?: () => number;
        readBytes?: () => number;
        writeBytes?: () => number;
      }
    | undefined;

  try {
    txResources = simAny.transactionData?.build?.()?.resources?.();
  } catch {
    txResources = undefined;
  }

  const cpuInstructions = parseNumeric(
    simAny.cost?.cpuInsns ?? txResources?.instructions?.(),
    0,
  );
  const ramBytes = parseNumeric(simAny.cost?.memBytes, 0);
  const readBytes = parseNumeric(txResources?.readBytes?.(), 0);
  const writeBytes = parseNumeric(txResources?.writeBytes?.(), 0);

  const baseResourceFee = parseNumeric(simAny.minResourceFee, 0);
  const restoreFee = parseNumeric(simAny.restorePreamble?.minResourceFee, 0);
  const minResourceFeeStroops = baseResourceFee + restoreFee;

  // Estimate CPU vs storage split from minResourceFeeStroops when exact split isn't separated by RPC
  const CPU_FEE_PER_10K_INSNS = 100;
  const estimatedCpuFee = Math.ceil(cpuInstructions / 10_000) * CPU_FEE_PER_10K_INSNS;
  const cpuFeeStroops =
    minResourceFeeStroops > 0
      ? Math.min(estimatedCpuFee, minResourceFeeStroops)
      : estimatedCpuFee;
  const storageFeeStroops = Math.max(0, minResourceFeeStroops - cpuFeeStroops);

  return {
    cpuInstructions,
    ramBytes,
    readBytes,
    writeBytes,
    cpuFeeStroops,
    storageFeeStroops,
    minResourceFeeStroops,
  };
}

function evaluateBalance(
  walletBalanceXlm: number | undefined,
  requiredXlm: number,
): BalanceCheck {
  if (
    typeof walletBalanceXlm !== "number" ||
    !Number.isFinite(walletBalanceXlm)
  ) {
    return {
      walletBalanceXlm: null,
      requiredXlm,
      insufficientBalance: false,
      shortfallXlm: 0,
    };
  }

  const shortfall = Math.max(0, requiredXlm - walletBalanceXlm);
  return {
    walletBalanceXlm,
    requiredXlm,
    insufficientBalance: shortfall > 0,
    shortfallXlm: Number(shortfall.toFixed(7)),
  };
}

export function useTransactionSimulation(
  defaultRpcUrlOrOptions?: string | UseTransactionSimulationOptions,
) {
  const options: UseTransactionSimulationOptions =
    typeof defaultRpcUrlOrOptions === "string"
      ? { rpcUrl: defaultRpcUrlOrOptions }
      : (defaultRpcUrlOrOptions ?? {});

  const defaultRpcUrl = options.rpcUrl;
  const autoSimulateInput = options.autoSimulateInput ?? null;
  const debounceMs = options.debounceMs ?? 350;

  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] =
    useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const simulate = useCallback(
    async (input: SimulateTxInput): Promise<SimulationResult> => {
      const currentRequestId = ++requestIdRef.current;
      setSimulating(true);
      setError(null);

      const bountyXlm = input.bountyXlm ?? 0;
      const baseFeeXlm = BASE_FEE_STROOPS / STROOPS_PER_XLM;
      const rpcUrl = input.rpcUrl || defaultRpcUrl || DEFAULT_RPC_URL;
      const networkPassphrase =
        input.networkPassphrase || EXPECTED_NETWORK_PASSPHRASE;

      try {
        const rpcServer = new rpc.Server(rpcUrl);
        const pubKey = input.publicKey || FALLBACK_PUBLIC_KEY;

        const accountResponse = await rpcServer.getAccount(pubKey);
        const account = new Account(pubKey, accountResponse.sequenceNumber());

        const tx = new TransactionBuilder(account, {
          fee: String(BASE_FEE_STROOPS),
          networkPassphrase,
        })
          .addOperation(
            new Contract(input.contractId).call(
              input.method,
              ...(input.args ?? []),
            ),
          )
          .setTimeout(30)
          .build();

        const simulation = await rpcServer.simulateTransaction(tx);

        if (!rpc.Api.isSimulationSuccess(simulation)) {
          const failedSim = simulation as {
            error?: unknown;
            errorResultXdr?: unknown;
            diagnosticEvents?: unknown;
            resultXdr?: unknown;
          };
          const simErrorMsg =
            typeof failedSim.error === "string"
              ? failedSim.error
              : "Soroban transaction simulation failed";
          throw new SorobanContractError(`Simulation failed: ${simErrorMsg}`, {
            resultXdr:
              typeof failedSim.errorResultXdr === "string"
                ? failedSim.errorResultXdr
                : typeof failedSim.resultXdr === "string"
                  ? failedSim.resultXdr
                  : undefined,
            diagnosticPayload:
              failedSim.diagnosticEvents ??
              failedSim.errorResultXdr ??
              failedSim.error,
          });
        }

        const preparedTx = rpc.assembleTransaction(tx, simulation).build();
        const resources = extractResourceCosts(simulation);

        const resourceFeeXlm =
          resources.minResourceFeeStroops / STROOPS_PER_XLM;
        const storageDepositXlm =
          resources.writeBytes > 0
            ? Math.max(
                DEFAULT_STORAGE_DEPOSIT_XLM,
                resources.storageFeeStroops / STROOPS_PER_XLM,
              )
            : DEFAULT_STORAGE_DEPOSIT_XLM;

        const minGasRequirementXlm = Number(
          (baseFeeXlm + resourceFeeXlm + storageDepositXlm).toFixed(7),
        );
        const totalXlm = Number((minGasRequirementXlm + bountyXlm).toFixed(7));

        const balanceCheck = evaluateBalance(input.walletBalanceXlm, totalXlm);
        const warningMessage = balanceCheck.insufficientBalance
          ? `Insufficient wallet balance: ${balanceCheck.walletBalanceXlm?.toFixed(4)} XLM available, but ${totalXlm.toFixed(4)} XLM is required (shortfall: ${balanceCheck.shortfallXlm.toFixed(4)} XLM).`
          : undefined;

        const totalFeeStroops =
          BASE_FEE_STROOPS + resources.minResourceFeeStroops;

        const result: SimulationResult = {
          success: true,
          itemizedFees: {
            networkBaseFeeXlm: baseFeeXlm,
            resourceFeeXlm,
            estimatedBountyXlm: bountyXlm,
            storageDepositXlm,
            minGasRequirementXlm,
            totalXlm,
          },
          transactionXdr: preparedTx.toXDR(),
          minFeeStroops: String(totalFeeStroops),
          resources,
          balanceCheck,
          warningMessage,
          willRevert: false,
          canSubmit: !balanceCheck.insufficientBalance,
          rawSimulation: simulation,
        };

        if (currentRequestId === requestIdRef.current) {
          setSimulationResult(result);
        }
        return result;
      } catch (err) {
        const mappedError = mapContractError(err);
        const diagnosticPayload =
          err && typeof err === "object" && "diagnosticPayload" in err
            ? (err as { diagnosticPayload?: unknown }).diagnosticPayload
            : undefined;
        const errorMessage = mappedError.userMessage;

        const totalXlm = Number((baseFeeXlm + bountyXlm).toFixed(7));
        const balanceCheck = evaluateBalance(input.walletBalanceXlm, totalXlm);

        const failedResult: SimulationResult = {
          success: false,
          itemizedFees: {
            networkBaseFeeXlm: baseFeeXlm,
            resourceFeeXlm: 0,
            estimatedBountyXlm: bountyXlm,
            storageDepositXlm: 0,
            minGasRequirementXlm: baseFeeXlm,
            totalXlm,
          },
          errorMessage,
          mappedError,
          diagnosticPayload,
          balanceCheck,
          willRevert: true,
          canSubmit: false,
        };

        if (currentRequestId === requestIdRef.current) {
          setError(`${mappedError.title}: ${errorMessage}`);
          setSimulationResult(failedResult);
        }
        return failedResult;
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setSimulating(false);
        }
      }
    },
    [defaultRpcUrl],
  );

  // Automatic debounced pre-flight simulation when autoSimulateInput is provided
  useEffect(() => {
    if (!autoSimulateInput?.contractId || !autoSimulateInput?.method) {
      return;
    }

    const timer = setTimeout(() => {
      void simulate(autoSimulateInput);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [autoSimulateInput, debounceMs, simulate]);

  const clearSimulation = useCallback(() => {
    requestIdRef.current += 1;
    setSimulationResult(null);
    setError(null);
    setSimulating(false);
  }, []);

  const insufficientBalance = useMemo(
    () => Boolean(simulationResult?.balanceCheck?.insufficientBalance),
    [simulationResult],
  );

  const canSubmit = useMemo(
    () =>
      Boolean(
        simulationResult?.success &&
          !simulationResult.willRevert &&
          !insufficientBalance &&
          !simulating,
      ),
    [simulationResult, insufficientBalance, simulating],
  );

  return {
    simulate,
    simulating,
    simulationResult,
    error,
    clearSimulation,
    insufficientBalance,
    canSubmit,
  };
}
