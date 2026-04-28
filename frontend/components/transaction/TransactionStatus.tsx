type TransactionStatusValue =
  | "pending"
  | "confirming"
  | "success"
  | "failed"
  | "unknown"

type TransactionStatusProps = {
  status: TransactionStatusValue
  txHash?: string
  confirmations?: number
  requiredConfirmations?: number
  compact?: boolean
}

const statusConfig = {
  pending: {
    label: "Pending",
    icon: "⏳",
    className: "bg-yellow-500/10 text-yellow-300 border-yellow-500/20",
    description: "Transaction is waiting to be submitted or picked up.",
  },
  confirming: {
    label: "Confirming",
    icon: "🔄",
    className: "bg-blue-500/10 text-blue-300 border-blue-500/20",
    description: "Transaction is being confirmed on-chain.",
  },
  success: {
    label: "Success",
    icon: "✅",
    className: "bg-green-500/10 text-green-300 border-green-500/20",
    description: "Transaction was confirmed successfully.",
  },
  failed: {
    label: "Failed",
    icon: "❌",
    className: "bg-red-500/10 text-red-300 border-red-500/20",
    description: "Transaction failed or was rejected by the network.",
  },
  unknown: {
    label: "Unknown",
    icon: "❔",
    className: "bg-neutral-500/10 text-neutral-300 border-neutral-500/20",
    description: "Transaction status is currently unavailable.",
  },
}

export default function TransactionStatus({
  status,
  txHash,
  confirmations,
  requiredConfirmations,
  compact = false,
}: TransactionStatusProps) {
  const config = statusConfig[status] ?? statusConfig.unknown

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}
        title={config.description}
      >
        <span aria-hidden="true">{config.icon}</span>
        {config.label}
      </span>
    )
  }

  return (
    <div className={`rounded-xl border p-4 ${config.className}`}>
      <div className="flex items-center gap-3">
        <span className="text-lg" aria-hidden="true">
          {config.icon}
        </span>
        <div>
          <p className="font-semibold">{config.label}</p>
          <p className="text-sm opacity-80">{config.description}</p>
        </div>
      </div>

      {(txHash || confirmations !== undefined) && (
        <div className="mt-3 space-y-1 text-xs opacity-80">
          {txHash && (
            <p>
              Tx Hash: <span className="font-mono">{txHash}</span>
            </p>
          )}

          {confirmations !== undefined && (
            <p>
              Confirmations: {confirmations}
              {requiredConfirmations ? `/${requiredConfirmations}` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export type { TransactionStatusValue }