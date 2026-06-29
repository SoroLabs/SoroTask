const pulse = "animate-pulse rounded bg-neutral-200 dark:bg-neutral-700";

export function CardSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
      <div className={`${pulse} h-4 w-1/3`} />
      <div className={`${pulse} h-3 w-full`} />
      <div className={`${pulse} h-3 w-4/5`} />
      <div className={`${pulse} mt-4 h-8 w-1/4`} />
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      <div className={`${pulse} h-4 w-full`} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${pulse} h-10 w-full`} />
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return <div className={`${pulse} h-48 w-full rounded-xl`} />;
}

export function StatCardSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="space-y-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <div className={`${pulse} h-3 w-1/2`} />
          <div className={`${pulse} h-7 w-2/3`} />
        </div>
      ))}
    </div>
  );
}

export function TaskListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading tasks">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4 shadow-sm"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className={`${pulse} h-4 w-44`} />
              <div className={`${pulse} h-3 w-64 max-w-full`} />
            </div>
            <div className={`${pulse} h-6 w-20 rounded-full`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`${pulse} h-3 w-full`} />
            <div className={`${pulse} h-3 w-5/6`} />
            <div className={`${pulse} h-3 w-2/3`} />
          </div>
        </div>
      ))}
    </div>
  );
}
