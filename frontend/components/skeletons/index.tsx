export function StatCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
      <div className="mb-3 h-4 w-24 rounded bg-slate-700" />
      <div className="h-8 w-32 rounded bg-slate-700" />
    </div>
  );
}

const pulse = "animate-pulse rounded bg-neutral-700/70";

export function CardSkeleton() {
  return (
    <div
      className="rounded-xl border border-neutral-700/50 bg-neutral-800/50 p-5"
      aria-hidden="true"
    >
      <div className={`${pulse} mb-4 h-4 w-1/3`} />
      <div className={`${pulse} mb-2 h-3 w-full`} />
      <div className={`${pulse} mb-5 h-3 w-4/5`} />
      <div className={`${pulse} h-8 w-1/4`} />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
      <div className="mb-4 h-4 w-32 rounded bg-slate-700" />
      <div className={`${pulse} h-48 w-full rounded-xl`} aria-hidden="true" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3 rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
      <div className={`${pulse} h-4 w-full mb-4`} />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-10 rounded bg-slate-700/70" />
      ))}
    </div>
  );
}

export function StatCardGroupSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      aria-label="Loading statistics"
      role="status"
    >
      {Array.from({ length: cards }).map((_, index) => (
        <div
          key={index}
          className="rounded-xl border border-neutral-700/50 bg-neutral-800/50 p-4"
          aria-hidden="true"
        >
          <div className={`${pulse} mb-3 h-3 w-1/2`} />
          <div className={`${pulse} h-7 w-2/3`} />
        </div>
      ))}
    </div>
  );
}

export function TaskListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="space-y-4"
      aria-label="Loading tasks"
      data-testid="task-list-skeleton"
      role="status"
    >
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="rounded-xl border border-neutral-700/50 bg-neutral-800/50 p-4"
          aria-hidden="true"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className={`${pulse} mb-3 h-5 w-32`} />
              <div className={`${pulse} h-4 w-full max-w-sm`} />
            </div>
            <div className={`${pulse} h-8 w-20`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={`${pulse} h-10`} />
            <div className={`${pulse} h-10`} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WidgetSkeleton({ size = "medium" }: { size?: "small" | "medium" | "large" }) {
  const rows = size === "large" ? 4 : size === "medium" ? 3 : 2;

  return (
    <div
      className="space-y-3"
      aria-label="Loading widget data"
      data-testid="widget-skeleton"
      role="status"
    >
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={`${pulse} h-4 ${index === rows - 1 ? "w-2/3" : "w-full"}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
