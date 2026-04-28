import { StatCardSkeleton, ChartSkeleton, TableSkeleton } from '@/components/skeletons'

export default function DashboardLoading() {
    return (
        <div className="space-y-6 p-6">
            <StatCardSkeleton />
            <ChartSkeleton />
            <TableSkeleton rows={6} />
        </div>
    )
}