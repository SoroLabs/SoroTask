import { StatusBadge } from "./StatusBadge";

export interface LogEntry {
  taskId: string;
  target: string;
  keeper: string;
  status: "success" | "failed" | "pending";
  timestamp: string;
}

interface LogsTableProps {
  logs?: LogEntry[];
  loading?: boolean;
}

export function LogsTable({ logs = [], loading = false }: LogsTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-700/50 shadow-xl">
      <table className="w-full text-left text-sm text-neutral-400">
        <thead className="bg-neutral-800/80 text-neutral-200 backdrop-blur-sm">
          <tr>
            <th className="px-6 py-4 font-medium">Task ID</th>
            <th className="px-6 py-4 font-medium">Target</th>
            <th className="px-6 py-4 font-medium">Keeper</th>
            <th className="px-6 py-4 font-medium">Status</th>
            <th className="px-6 py-4 font-medium">Timestamp</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800 bg-neutral-900/50">
          {loading && (
            <tr>
              <td colSpan={5} className="px-6 py-8 text-center text-neutral-500">
                Loading…
              </td>
            </tr>
          )}
          {!loading && logs.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-8 text-center text-neutral-500">
                No execution logs yet.
              </td>
            </tr>
          )}
          {!loading &&
            logs.map((log) => (
              <tr
                key={log.taskId}
                className="hover:bg-neutral-800/50 transition-colors"
              >
                <td className="px-6 py-4 font-mono text-neutral-300">
                  {log.taskId}
                </td>
                <td className="px-6 py-4 font-mono">{log.target}</td>
                <td className="px-6 py-4 font-mono">{log.keeper}</td>
                <td className="px-6 py-4">
                  <StatusBadge status={log.status} />
                </td>
                <td className="px-6 py-4">{log.timestamp}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
