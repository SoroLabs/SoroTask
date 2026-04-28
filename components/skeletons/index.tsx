const pulse = `animate-pulse bg-neutral-200 dark:bg-neutral-700 rounded`

export function CardSkeleton() {
    return (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 space-y-3">
            <div className={`${pulse} h-4 w-1/3`} />
            <div className={`${pulse} h-3 w-full`} />
            <div className={`${pulse} h-3 w-4/5`} />
            <div className={`${pulse} h-8 w-1/4 mt-4`} />
        </div>
    )
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
    return (
        <div className="space-y-2">
            <div className={`${pulse} h-4 w-full`} />
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className={`${pulse} h-10 w-full`} />
            ))}
        </div>
    )
}

export function ChartSkeleton() {
    return (
        <div className={`${pulse} h-48 w-full rounded-xl`} />
    )
}

export function StatCardSkeleton() {
    return (
        <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => (
                <div key={i} className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 space-y-2">
                    <div className={`${pulse} h-3 w-1/2`} />
                    <div className={`${pulse} h-7 w-2/3`} />
                </div>
            ))}
        </div>
    )
}