import TaskChart from '@/components/TaskChart'
import KeeperLeaderboard from '@/components/KeeperLeaderboard'
import ActivityFeed from '@/components/ActivityFeed'
import dynamic from 'next/dynamic'

const TaskChart = dynamic(() => import('@/components/TaskChart'), {
    loading: () => <ChartSkeleton />,
    ssr: false,          // chart libs often need window
})

const KeeperLeaderboard = dynamic(() => import('@/components/KeeperLeaderboard'), {
    loading: () => <TableSkeleton rows={5} />,
})

const ActivityFeed = dynamic(() => import('@/components/ActivityFeed'), {
    loading: () => <FeedSkeleton />,
})