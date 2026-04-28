type Status = "success" | "failed" | "pending";

interface StatusBadgeProps {
  status: Status;
}

const config: Record<Status, { label: string; classes: string }> = {
  success: {
    label: "Success",
    classes:
      "bg-green-500/10 text-green-400 border border-green-500/20",
  },
  failed: {
    label: "Failed",
    classes: "bg-red-500/10 text-red-400 border border-red-500/20",
  },
  pending: {
    label: "Pending",
    classes:
      "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, classes } = config[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
}
