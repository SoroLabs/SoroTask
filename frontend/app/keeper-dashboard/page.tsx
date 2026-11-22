'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { PerformanceMetric, StatusDistribution, AnalyticsSummary } from '@/types/keeper-analytics.types';
import KeeperGlobe, { type KeeperNode, type TopologyEvent } from '@/components/KeeperGlobe';

const MOCK_PERFORMANCE_DATA: PerformanceMetric[] = [
  { date: 'Jul 18', earnedXlm: 120, gasSpentXlm: 18, netProfitXlm: 102, executions: 45 },
  { date: 'Jul 19', earnedXlm: 150, gasSpentXlm: 22, netProfitXlm: 128, executions: 58 },
  { date: 'Jul 20', earnedXlm: 90, gasSpentXlm: 14, netProfitXlm: 76, executions: 32 },
  { date: 'Jul 21', earnedXlm: 210, gasSpentXlm: 30, netProfitXlm: 180, executions: 82 },
  { date: 'Jul 22', earnedXlm: 180, gasSpentXlm: 25, netProfitXlm: 155, executions: 70 },
  { date: 'Jul 23', earnedXlm: 240, gasSpentXlm: 32, netProfitXlm: 208, executions: 95 },
  { date: 'Jul 24', earnedXlm: 280, gasSpentXlm: 38, netProfitXlm: 242, executions: 110 },
];

const MOCK_STATUS_DISTRIBUTION: StatusDistribution[] = [
  { name: 'Successful', value: 462, color: '#10B981' },
  { name: 'Reverted / Failed', value: 24, color: '#EF4444' },
  { name: 'Slippage Exceeded', value: 8, color: '#F59E0B' },
];

const MOCK_SUMMARY: AnalyticsSummary = {
  totalEarnedXlm: 1270,
  totalGasSpentXlm: 179,
  netProfitXlm: 1091,
  profitMarginPercent: 85.9,
  totalExecutions: 494,
  successRatePercent: 93.5,
};

const KEEPER_NODES: KeeperNode[] = [
  { id: 'node-east-01', label: 'Tokyo-1', region: 'APAC-East', latitude: 35.6762, longitude: 139.6503, uptime: 0.997, activeTasks: 14, hardwareTier: 't1', lastHeartbeat: Date.now() - 1200, latencyMs: 38, consensusWeight: 1.02 },
  { id: 'node-east-02', label: 'Seoul-1', region: 'APAC-East', latitude: 37.5665, longitude: 126.9780, uptime: 0.991, activeTasks: 9, hardwareTier: 't2', lastHeartbeat: Date.now() - 2400, latencyMs: 44, consensusWeight: 0.97 },
  { id: 'node-east-03', label: 'Singapore-1', region: 'APAC-South', latitude: 1.3521, longitude: 103.8198, uptime: 0.999, activeTasks: 22, hardwareTier: 't1', lastHeartbeat: Date.now() - 900, latencyMs: 52, consensusWeight: 1.15 },
  { id: 'node-west-01', label: 'London-1', region: 'EMEA-West', latitude: 51.5074, longitude: -0.1278, uptime: 0.984, activeTasks: 7, hardwareTier: 't2', lastHeartbeat: Date.now() - 1800, latencyMs: 98, consensusWeight: 0.89 },
  { id: 'node-west-02', label: 'Frankfurt-1', region: 'EMEA-West', latitude: 50.1109, longitude: 8.6821, uptime: 0.992, activeTasks: 11, hardwareTier: 't2', lastHeartbeat: Date.now() - 1500, latencyMs: 104, consensusWeight: 0.95 },
  { id: 'node-west-03', label: 'Paris-1', region: 'EMEA-West', latitude: 48.8566, longitude: 2.3522, uptime: 0.976, activeTasks: 4, hardwareTier: 't3', lastHeartbeat: Date.now() - 4100, latencyMs: 111, consensusWeight: 0.72 },
  { id: 'node-na-01', label: 'Ashburn-1', region: 'AMER-N', latitude: 38.9072, longitude: -77.0369, uptime: 0.995, activeTasks: 18, hardwareTier: 't1', lastHeartbeat: Date.now() - 1100, latencyMs: 66, consensusWeight: 1.08 },
  { id: 'node-na-02', label: 'Dallas-1', region: 'AMER-S', latitude: 32.7767, longitude: -96.7970, uptime: 0.988, activeTasks: 10, hardwareTier: 't2', lastHeartbeat: Date.now() - 2200, latencyMs: 72, consensusWeight: 0.93 },
  { id: 'node-na-03', label: 'Santiago-1', region: 'AMER-S', latitude: -33.4489, longitude: -70.6693, uptime: 0.965, activeTasks: 3, hardwareTier: 't3', lastHeartbeat: Date.now() - 6800, latencyMs: 158, consensusWeight: 0.58 },
  { id: 'node-na-04', label: 'Toronto-1', region: 'AMER-N', latitude: 43.6532, longitude: -79.3832, uptime: 0.981, activeTasks: 6, hardwareTier: 't3', lastHeartbeat: Date.now() - 3200, latencyMs: 81, consensusWeight: 0.79 },
];

export default function KeeperDashboardPage() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [nodes, setNodes] = useState<KeeperNode[]>(KEEPER_NODES);
  const [events, setEvents] = useState<TopologyEvent[]>([]);
  const eventQueueRef = useRef<TopologyEvent[]>([]);
  const emitterRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const emit = useCallback((evt: TopologyEvent) => {
    eventQueueRef.current.push(evt);
    if (eventQueueRef.current.length > 400) {
      eventQueueRef.current = eventQueueRef.current.slice(-200);
    }
    setEvents((prev) => {
      const next = [...prev, evt];
      if (next.length > 400) return next.slice(-200);
      return next;
    });
  }, []);

  useEffect(() => {
    const scheduleNext = () => {
      const delay = 450 + Math.random() * 1100;
      const pick = Math.random();
      if (pick < 0.55) {
        const idx = Math.floor(Math.random() * nodes.length);
        const src = nodes[idx];
        const dstIdx = (idx + 1 + Math.floor(Math.random() * (nodes.length - 1))) % nodes.length;
        const dst = nodes[dstIdx];
        emit({
          type: 'task-execution',
          fromNodeId: src.id,
          toNodeId: dst.id,
          timestamp: Date.now(),
          region: src.region,
          value: Math.floor(1 + Math.random() * 6),
        });
      } else if (pick < 0.8) {
        const idx = Math.floor(Math.random() * nodes.length);
        const node = nodes[idx];
        emit({
          type: 'heartbeat',
          fromNodeId: node.id,
          timestamp: Date.now(),
          region: node.region,
        });
      } else {
        const idx = Math.floor(Math.random() * nodes.length);
        const node = nodes[idx];
        emit({
          type: 'consensus-vote',
          fromNodeId: node.id,
          timestamp: Date.now(),
          region: node.region,
          value: Math.random() > 0.5 ? 1 : 0,
        });
      }
    };
    scheduleNext();
    emitterRef.current = setInterval(scheduleNext, 650 + Math.random() * 700);
    return () => {
      if (emitterRef.current) clearInterval(emitterRef.current);
    };
  }, [nodes, emit]);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        lastHeartbeat: Date.now() - Math.floor(Math.random() * 3000),
        activeTasks: Math.max(0, n.activeTasks + (Math.random() > 0.7 ? 1 : Math.random() < 0.2 ? -1 : 0)),
      }))
    );
  }, [nodes.length]);


  const exportAsJSON = () => {
    const payload = {
      summary: MOCK_SUMMARY,
      performance: MOCK_PERFORMANCE_DATA,
      topology: { nodes: nodes.map((n) => ({ id: n.id, label: n.label, region: n.region, uptime: n.uptime, activeTasks: n.activeTasks, hardwareTier: n.hardwareTier, latencyMs: n.latencyMs, consensusWeight: n.consensusWeight })), events: events.length },
      exportedAt: new Date().toISOString(),
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `keeper_topology_${timeRange}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const exportAsCSV = () => {
    const headers = ['Date', 'Earned XLM', 'Gas Spent XLM', 'Net Profit XLM', 'Executions'];
    const rows = MOCK_PERFORMANCE_DATA.map((row) =>
      [row.date, row.earnedXlm, row.gasSpentXlm, row.netProfitXlm, row.executions].join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', encodedUri);
    downloadAnchor.setAttribute('download', `keeper_analytics_${timeRange}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const totalActiveTasks = nodes.reduce((acc, n) => acc + n.activeTasks, 0);
  const avgUptime = nodes.reduce((acc, n) => acc + n.uptime, 0) / nodes.length;
  const regionCounts = nodes.reduce((acc, n) => { acc[n.region] = (acc[n.region] || 0) + 1; return acc; }, {} as Record<string, number>);
  const regionEntries = Object.entries(regionCounts).map(([region, count]) => ({ region, count }));

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 text-foreground">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Keeper Network Topology</h1>
          <p className="text-sm text-muted-foreground">
            Live view of the decentralized keeper mesh — geographic distribution, health, latency, and real-time task flow.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-slate-700">{nodes.length}</span> nodes ·{' '}
            <span className="font-medium text-emerald-600">{(avgUptime * 100).toFixed(2)}%</span> avg uptime ·{' '}
            <span className="font-medium text-sky-600">{totalActiveTasks}</span> active tasks
          </div>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as any)}
            className="px-3 py-1.5 border rounded-md text-sm font-medium bg-background focus:ring-2 focus:ring-primary"
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>

          <button
            onClick={exportAsCSV}
            className="px-3 py-1.5 text-xs font-semibold border rounded-md hover:bg-muted transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={exportAsJSON}
            className="px-3 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Export JSON
          </button>
        </div>
      </div>      {/* Topology Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 border rounded-xl bg-card shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Active Nodes</p>
          <p className="text-2xl font-bold font-mono mt-1 text-sky-600">{nodes.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Across {regionEntries.length} regions</p>
        </div>

        <div className="p-5 border rounded-xl bg-card shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Average Uptime</p>
          <p className="text-2xl font-bold font-mono mt-1 text-emerald-600">{(avgUptime * 100).toFixed(2)}%</p>
          <p className="text-xs text-muted-foreground mt-1">Verified node health</p>
        </div>

        <div className="p-5 border rounded-xl bg-card shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Active Tasks Now</p>
          <p className="text-2xl font-bold font-mono mt-1 text-indigo-600">{totalActiveTasks}</p>
          <p className="text-xs text-muted-foreground mt-1">Live allocations</p>
        </div>

        <div className="p-5 border rounded-xl bg-card shadow-sm">
          <p className="text-xs font-semibold text-muted-foreground">Avg Latency</p>
          <p className="text-2xl font-bold font-mono mt-1 text-amber-600">
            {Math.round(nodes.reduce((s, n) => s + n.latencyMs, 0) / nodes.length)} ms
          </p>
          <p className="text-xs text-muted-foreground mt-1">Round-trip ping</p>
        </div>
      </div>

      {/* Region distribution mini-list */}
      <div className="flex flex-wrap gap-2">
        {regionEntries.map(({ region, count }) => (
          <div key={region} className="rounded-lg border border-neutral-200 bg-white/70 px-3 py-1.5 text-xs shadow-sm">
            <span className="font-medium text-slate-700">{region}</span>
            <span className="ml-2 text-slate-500">· {count} nodes</span>
          </div>
        ))}
      </div>

      {/* 3D globe */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-2xl" style={{ height: 520 }}>
        <KeeperGlobe nodes={nodes} events={events} width={Number((window.innerWidth - 64) || 900)} height={500} />
      </div>

      {/* Visualizations Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Earnings vs Gas Area Chart */}
        <div className="lg:col-span-2 p-6 border rounded-xl bg-card shadow-sm space-y-4">
          <h2 className="text-base font-semibold">Earnings & Gas Expenditure Trends</h2>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={MOCK_PERFORMANCE_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="earnedColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gasColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area type="monotone" dataKey="earnedXlm" stroke="#10B981" fillOpacity={1} fill="url(#earnedColor)" name="Earned (XLM)" />
                <Area type="monotone" dataKey="gasSpentXlm" stroke="#EF4444" fillOpacity={1} fill="url(#gasColor)" name="Gas Spent (XLM)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Success vs Failure Breakdown */}
        <div className="p-6 border rounded-xl bg-card shadow-sm space-y-4">
          <h2 className="text-base font-semibold">Execution Status Breakdown</h2>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={MOCK_STATUS_DISTRIBUTION}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {MOCK_STATUS_DISTRIBUTION.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}